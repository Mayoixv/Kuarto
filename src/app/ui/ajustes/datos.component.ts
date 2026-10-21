import { Component, computed, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SelectFieldComponent } from '../select/select-field.component';
import { AlertController, IonIcon, IonToggle, LoadingController, ModalController } from '@ionic/angular';
import { FormSheetComponent, FormSheetField } from '../select/form-sheet.component';
import { applyPrivacy, isPrivacyOn, privacyAvailable, setPrivacy } from '../privacy';
import { NotificationsService } from '../notifications.service';
import { AutoBackupService } from '../auto-backup.service';
import { CloudBackupService } from '../cloud/cloud-backup.service';
import { formatDay } from '../format';
import { addIcons } from 'ionicons';
import { chevronForward } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { AppError } from '../../application/errors';
import { AUTO_BACKUP_KEEP_OPTIONS, AutoBackupFrequency, WIPE_CONFIRMATION } from '../../application/use-cases/backup';
import { saveSafetyCopy } from '../backup-files';
import { todayIso } from '../format';
import { fileDate, pickFile, saveFile } from '../file-io';
import { MAX_BACKUP_BYTES } from '../../application/backup-crypto';
import { monthLabel } from '../format';
import { LockState } from '../lock/lock-state';
import { t, errorText } from '../i18n';

type Values = Record<string, string>;
interface AskInput {
  name: string;
  type: 'text' | 'password';
  placeholder: string;
  attributes?: { inputmode?: string; maxlength?: number; autocomplete?: string; autocapitalize?: string };
}

/** Fecha (ISO) del último respaldo creado a mano. */
const LAST_MANUAL_KEY = 'backup_last_manual';

/** Secciones "Tus datos" (respaldo, restauración, CSV) y "Bloqueo con PIN" de Ajustes. */
@Component({
  selector: 'app-datos',
  templateUrl: 'datos.component.html',
  styleUrls: ['datos.component.scss'],
  imports: [RouterLink, SelectFieldComponent, IonIcon, IonToggle],
})
export class DatosComponent implements OnInit {
  protected readonly t = t;
  /** Qué sección muestra: Datos y respaldo, o Seguridad y privacidad. */
  readonly part = input<'datos' | 'seguridad'>('datos');
  /** Empieza a activar el respaldo automático al abrir (desde el final del recorrido). */
  readonly startAuto = input(false);
  /** Empieza a entrar con Google para el respaldo en la nube (desde el final del recorrido). */
  readonly startCloud = input(false);
  private readonly container = inject(APP_CONTAINER);
  private readonly alerts = inject(AlertController);
  private readonly loading = inject(LoadingController);
  private readonly modals = inject(ModalController);
  protected readonly lock = inject(LockState);
  private readonly notifications = inject(NotificationsService);
  protected readonly autoBackup = inject(AutoBackupService);
  protected readonly cloud = inject(CloudBackupService);
  private readonly autoToggle = viewChild<IonToggle>('autoToggle');
  protected readonly autoBackupDetail = computed(() => {
    if (!this.autoBackup.available) return t('common.phoneOnly');
    if (this.autoBackup.needsPassword()) return t('datos.autoNeedsPassword');
    if (!this.autoBackup.enabled()) return t('datos.autoOff');
    if (this.autoBackup.lastError()) return t('datos.autoError');
    const last = this.autoBackup.lastRun();
    return last ? t('datos.autoLast', { date: formatDay(last) }) : t('datos.autoPending');
  });
  protected readonly frequencyOptions = computed(() => [
    { value: 1 as AutoBackupFrequency, label: t('datos.daily') },
    { value: 7 as AutoBackupFrequency, label: t('datos.weekly') },
  ]);
  protected readonly keepOptions = computed(() => AUTO_BACKUP_KEEP_OPTIONS.map((count) => ({ value: count as number, label: t('datos.keepN', { count }) })));
  /** Fecha del último respaldo hecho a mano, ya con formato. */
  protected readonly lastManual = signal<string | null>(null);
  protected readonly lockOptions = computed(() => [
    { value: 0, label: t('seguridad.lockNow') },
    { value: 60, label: t('seguridad.lock1') },
    { value: 300, label: t('seguridad.lock5') },
    { value: 900, label: t('seguridad.lock15') },
  ]);

  protected readonly pinEnabled = signal(false);
  protected readonly privacy = signal(false);
  protected readonly privacyAvailable = privacyAvailable;
  private readonly privacyToggle = viewChild<IonToggle>('privacyToggle');
  private readonly bioToggle = viewChild<IonToggle>('bioToggle');
  protected readonly biometryAvailable = signal(false);
  protected readonly status = signal('');

  constructor() {
    addIcons({ chevronForward });
  }

  async ngOnInit() {
    this.pinEnabled.set(await this.container.pinLock.isEnabled());
    this.privacy.set(await isPrivacyOn(this.container.settings));
    if (this.autoBackup.available) await this.autoBackup.refresh();
    const last = await this.container.settings.get(LAST_MANUAL_KEY);
    this.lastManual.set(last ? formatDay(last) : null);
    if (this.startAuto() && this.autoBackup.available && !this.autoBackup.enabled()) await this.toggleAutoBackup(true);
    else if (this.startCloud() && this.cloud.available && !this.cloud.email()) await this.cloudSignIn();
    this.biometryAvailable.set(await this.lock.biometryAvailable().catch(() => false));
  }

  /** Devuelve true si el respaldo se creó y se entregó para guardar. */
  protected async createBackup(): Promise<boolean> {
    const values = await this.ask(
      t('datos.createBackup'),
      t('datos.createBackupMsg'),
      [
        { name: 'p1', type: 'password', placeholder: t('datos.passwordMin'), attributes: { autocomplete: 'new-password' } },
        { name: 'p2', type: 'password', placeholder: t('datos.passwordRepeat'), attributes: { autocomplete: 'new-password' } },
      ],
      t('datos.create'),
    );
    if (!values) return false;
    if (values['p1'] !== values['p2']) {
      await this.fail(t('datos.passwordsDiffer'));
      return false;
    }
    const done = await this.busy(t('datos.encrypting'), async () => {
      const file = await this.container.createBackup.execute(values['p1']);
      const where = await saveFile(`kuarto-respaldo-${fileDate()}.finanzas`, file, 'application/json');
      this.status.set(where ? t('datos.savedAt', { where }) : t('datos.downloaded'));
      await this.container.settings.set(LAST_MANUAL_KEY, todayIso());
      this.lastManual.set(formatDay(todayIso()));
      return true;
    });
    return done === true;
  }

  protected async wipeAll() {
    const warning = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('datos.wipe'),
      message: t('datos.wipeMsg'),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('datos.wipeNoBackup'), role: 'continue' },
        { text: t('datos.createBackup'), role: 'backup' },
      ],
    });
    await warning.present();
    const { role } = await warning.onDidDismiss();
    if (role === 'backup') {
      if (!(await this.createBackup())) return;
    } else if (role !== 'continue') {
      return;
    }

    const values = await this.ask(
      t('datos.wipeConfirmTitle'),
      t('datos.wipeConfirmMsg', { word: WIPE_CONFIRMATION }),
      [{ name: 'w', type: 'text', placeholder: WIPE_CONFIRMATION, attributes: { autocapitalize: 'characters', autocomplete: 'off' } }],
      t('datos.wipeAll'),
    );
    if (!values) return;
    const done = await this.busy(t('datos.wiping'), async () => {
      await this.container.wipeAllData.execute(values['w']);
      // La contraseña del respaldo automático vive fuera de la base: también se borra.
      await this.container.autoBackup.disable();
      // Ya sin datos: que no quede ningún aviso programado ni la pantalla protegida.
      if (this.notifications.available) await this.notifications.disable();
      await applyPrivacy(false);
      return true;
    });
    // La app arranca de cero: bienvenida, sin PIN.
    if (done) location.replace('/');
  }

  protected async restoreBackup() {
    // Sin `accept`: Android no conoce la extensión .finanzas y, si se filtra por ella, deja todo en gris.
    const file = await pickFile();
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return this.fail(t('errors.backupTooBig', { mb: MAX_BACKUP_BYTES / 1024 / 1024 }));
    const text = await file.text().catch(() => null);
    if (text) await this.restoreFromText(text);
  }

  /** Abre un respaldo cifrado (de un archivo o de la nube), muestra qué trae y, si se confirma, reemplaza los datos. */
  private async restoreFromText(text: string) {
    const values = await this.ask(t('datos.restore'), t('datos.restorePasswordMsg'), [
      { name: 'p', type: 'password', placeholder: t('datos.password'), attributes: { autocomplete: 'current-password' } },
    ], t('datos.open'));
    if (!values) return;

    const opened = await this.busy(t('datos.opening'), () => this.container.openBackup.execute(text, values['p']));
    if (!opened) return;
    const { transactions, firstMonth, lastMonth } = opened.summary;
    const range = !firstMonth || !lastMonth
      ? ''
      : firstMonth === lastMonth
        ? t('datos.rangeOne', { month: monthLabel(firstMonth) })
        : t('datos.rangeMany', { from: monthLabel(firstMonth), to: monthLabel(lastMonth) });
    const auto = this.autoBackup.enabled();
    const confirm = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('datos.replaceTitle'),
      message: t(auto ? 'datos.replaceMsgAuto' : 'datos.replaceMsg', { count: transactions, range }),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('datos.restoreBtn'), role: 'destructive' },
      ],
    });
    await confirm.present();
    if ((await confirm.onDidDismiss()).role !== 'destructive') return;
    if (!(await this.backUpCurrent(auto))) return;

    const done = await this.busy(t('datos.restoring'), async () => {
      // Copia privada de lo actual, además del respaldo: si el restaurado no era el bueno, hay de dónde volver.
      await saveSafetyCopy(await this.container.restoreBackup.current(), 'antes-de-restaurar-').catch(console.error);
      await this.container.restoreBackup.execute(opened.data);
      return true;
    });
    // Recargar es la forma más simple de que cada pantalla, la moneda y el PIN tomen los datos nuevos.
    if (done) location.reload();
  }

  /**
   * Antes de restaurar, un respaldo de lo que hay ahora: el automático si está activado; si no, se ofrece crear uno.
   * Devuelve false si hay que cancelar la restauración.
   */
  private async backUpCurrent(auto: boolean): Promise<boolean> {
    if (auto) {
      const saved = await this.busy(t('datos.savingCurrent'), () => this.autoBackup.runNow());
      if (!saved) await this.fail(t('datos.currentFailed'));
      return !!saved;
    }
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('datos.beforeRestoreTitle'),
      message: t('datos.beforeRestoreMsg'),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('datos.wipeNoBackup'), role: 'continue' },
        { text: t('datos.createBackup'), role: 'backup' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'backup') return this.createBackup();
    return role === 'continue';
  }

  protected async setFrequency(days: AutoBackupFrequency) {
    try {
      await this.autoBackup.setFrequency(days);
    } catch (e) {
      console.error(e);
      this.status.set(t('common.changeFailed'));
    }
  }

  protected async setKeep(count: number) {
    try {
      await this.autoBackup.setKeep(count);
    } catch (e) {
      console.error(e);
      this.status.set(t('common.changeFailed'));
    }
  }

  protected async exportCsv() {
    await this.busy(t('datos.preparing'), async () => {
      const { csv, rows } = await this.container.exportCsv.execute();
      const where = await saveFile(`kuarto-movimientos-${fileDate()}.csv`, csv, 'text/csv');
      this.status.set(where ? t('datos.exportedAt', { count: rows, where }) : t('datos.exported', { count: rows }));
    });
  }

  protected async enablePin() {
    const values = await this.ask(
      this.pinEnabled() ? t('seguridad.changePin') : t('seguridad.enablePin'),
      t('seguridad.pinMsg'),
      [
        { name: 'p1', type: 'password', placeholder: t('seguridad.newPin'), attributes: { inputmode: 'numeric', maxlength: 6 } },
        { name: 'p2', type: 'password', placeholder: t('seguridad.repeatPin'), attributes: { inputmode: 'numeric', maxlength: 6 } },
      ],
      t('common.save'),
    );
    if (!values) return;
    if (values['p1'] !== values['p2']) return this.fail(t('seguridad.pinsDiffer'));
    const ok = await this.busy(t('seguridad.savingPin'), async () => {
      await this.container.pinLock.enable(values['p1']);
      return true;
    });
    if (!ok) return;
    this.pinEnabled.set(true);
    this.lock.setEnabled(true, values['p1'].length);
    this.status.set(t('seguridad.pinOn'));
  }

  protected async disablePin() {
    const values = await this.ask(t('seguridad.removePin'), t('seguridad.currentPinMsg'), [
      { name: 'p', type: 'password', placeholder: t('seguridad.currentPin'), attributes: { inputmode: 'numeric', maxlength: 6 } },
    ], t('seguridad.remove'));
    if (!values) return;
    const check = await this.busy(t('seguridad.checking'), () => this.container.pinLock.disable(values['p']));
    if (!check) return;
    if (!check.ok) {
      return this.fail(check.waitSeconds ? t('seguridad.tooMany', { seconds: check.waitSeconds }) : t('seguridad.wrongPin'));
    }
    this.pinEnabled.set(false);
    this.lock.setEnabled(false);
    if (this.lock.biometricOn()) await this.lock.setBiometric(false);
    this.status.set(t('seguridad.pinOff'));
  }

  /** Pide uno o dos campos en una hoja propia (las contraseñas con su ojo para verlas). Null si se cancela. */
  private async ask(header: string, message: string, inputs: AskInput[], okText: string): Promise<Values | null> {
    const fields: FormSheetField[] = inputs.map((i) => ({
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      numeric: i.attributes?.inputmode === 'numeric',
      maxlength: i.attributes?.maxlength,
      autocomplete: i.attributes?.autocomplete,
      autocapitalize: i.attributes?.autocapitalize,
    }));
    const sheet = await this.modals.create({
      component: FormSheetComponent,
      componentProps: { header, message, fields, okText },
      cssClass: 'select-modal',
    });
    await sheet.present();
    const { data, role } = await sheet.onWillDismiss<Values>();
    return role === 'confirm' && data ? data : null;
  }

  /** Muestra "cargando" mientras corre `work`; los errores se explican y devuelven undefined. */
  private async busy<T>(message: string, work: () => Promise<T>): Promise<T | undefined> {
    const spinner = await this.loading.create({ message });
    await spinner.present();
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof AppError)) console.error(error);
      await spinner.dismiss();
      await this.fail(errorText(error));
      return undefined;
    } finally {
      await spinner.dismiss();
    }
  }

  private async fail(message: string) {
    const alert = await this.alerts.create({ cssClass: 'app-alert', header: t('common.failedTitle'), message, buttons: [t('common.understood')] });
    await alert.present();
  }

  protected async setLockAfter(seconds: number) {
    try {
      await this.lock.setLockAfter(seconds);
      this.status.set(t('seguridad.lockSaved'));
    } catch (e) {
      console.error(e);
      this.status.set(t('seguridad.lockFailed'));
    }
  }

  protected async togglePrivacy(on: boolean) {
    if (on === this.privacy()) return;
    try {
      await setPrivacy(this.container.settings, on);
      this.privacy.set(on);
      this.status.set(on ? t('seguridad.privacyOn') : t('seguridad.privacyOff'));
    } catch (e) {
      console.error(e);
      this.status.set(t('common.changeFailed'));
      const toggle = this.privacyToggle();
      if (toggle) toggle.checked = this.privacy();
    }
  }

  protected async toggleBiometric(on: boolean) {
    if (on === this.lock.biometricOn()) return;
    try {
      const ok = await this.lock.setBiometric(on);
      this.status.set(
        !ok ? t('seguridad.bioNotConfirmed') : on ? t('seguridad.bioOn') : t('seguridad.bioOff'),
      );
    } catch (e) {
      console.error(e);
      this.status.set(t('common.changeFailed'));
    } finally {
      const toggle = this.bioToggle();
      if (toggle) toggle.checked = this.lock.biometricOn();
    }
  }

  /** Entra con Google. La nube guarda el respaldo semanal, así que primero tiene que estar activado. */
  protected async cloudSignIn() {
    if (!this.autoBackup.enabled()) {
      await this.toggleAutoBackup(true);
      if (!this.autoBackup.enabled()) return;
    }
    const done = await this.busy(t('datos.cloudSigningIn'), async () => {
      await this.cloud.signIn();
      return true;
    });
    if (done) await this.cloudUpload();
  }

  protected async cloudUpload() {
    const done = await this.busy(t('datos.cloudUploading'), async () => {
      await this.cloud.upload(await this.container.autoBackup.create());
      return true;
    });
    if (done) this.status.set(t('datos.cloudUploaded'));
  }

  protected async cloudRestore() {
    const list = await this.busy(t('datos.cloudSearching'), () => this.cloud.list());
    if (!list) return;
    if (!list.length) return this.fail(t('datos.cloudEmpty'));
    const alert = await this.alerts.create({
      cssClass: 'app-alert choices',
      header: t('datos.cloudRestore'),
      message: t('datos.cloudChooseMsg'),
      buttons: [
        ...list.map((b, i) => {
          const date = formatDay(b.createdAt.slice(0, 10));
          return { text: i === 0 ? t('datos.cloudLatest', { date }) : date, role: b.id };
        }),
        { text: t('common.cancel'), role: 'cancel' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (!role || role === 'cancel' || role === 'backdrop') return;
    const text = await this.busy(t('datos.downloading'), () => this.cloud.download(role));
    if (text) await this.restoreFromText(text);
  }

  protected async cloudSignOut() {
    await this.busy(t('datos.signingOut'), async () => {
      await this.cloud.signOut();
      return true;
    });
    this.status.set(t('datos.signedOut'));
  }

  protected async toggleAutoBackup(on: boolean) {
    if (on === this.autoBackup.enabled()) return;
    try {
      if (!on) {
        await this.autoBackup.disable();
        this.status.set(t('datos.autoDisabled'));
        return;
      }
      const values = await this.ask(
        t('datos.autoTitle'),
        t('datos.autoMsg'),
        [
          { name: 'p1', type: 'password', placeholder: t('datos.passwordMin'), attributes: { autocomplete: 'new-password' } },
          { name: 'p2', type: 'password', placeholder: t('datos.passwordRepeat'), attributes: { autocomplete: 'new-password' } },
        ],
        t('datos.activate'),
      );
      if (!values) return;
      if (values['p1'] !== values['p2']) return this.fail(t('datos.passwordsDiffer'));
      const saved = await this.busy(t('datos.autoFirst'), () => this.autoBackup.enable(values['p1']));
      if (saved === false) await this.fail(t('datos.autoFirstFailed'));
      else if (saved) this.status.set(t('datos.autoEnabled'));
    } finally {
      const toggle = this.autoToggle();
      if (toggle) toggle.checked = this.autoBackup.enabled();
    }
  }
}
