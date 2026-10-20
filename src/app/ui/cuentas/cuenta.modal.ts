import { Component, computed, inject, Input, OnInit, signal } from '@angular/core';
import { SelectFieldComponent } from '../select/select-field.component';
import { AlertController, IonContent, IonIcon, IonInput, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { AccountView } from '../../application/use-cases/accounts';
import { AccountType, CASH_ACCOUNT_ID, isCard } from '../../domain/account';
import { CurrencyState } from '../currency-state';
import { amountToInput, parseAmount, parseBalance, todayIso } from '../format';
import { SuccessCheckComponent } from '../success-check.component';
import { ACCOUNT_TYPES, accountTypeLabel } from './account-choices';
import { t, errorText } from '../i18n';

/** Cuánto se ve el check de éxito antes de cerrar (design.md, 10.2). */
const SUCCESS_VISIBLE_MS = 1200;

@Component({
  selector: 'app-cuenta-modal',
  templateUrl: 'cuenta.modal.html',
  styleUrls: ['cuenta.modal.scss'],
  imports: [SelectFieldComponent, IonContent, IonIcon, IonInput, SuccessCheckComponent],
})
export class CuentaModalComponent implements OnInit {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  private readonly alerts = inject(AlertController);

  /** Si llega, el formulario edita esta cuenta en vez de crear una. */
  @Input() view?: AccountView;
  /** Tipo propuesto al crear (desde la sección Tarjetas, una tarjeta). */
  @Input() presetType?: AccountType;
  /** En las preguntas iniciales: no guarda, devuelve lo escrito (role 'draft') para guardarlo todo al final. */
  @Input() draft = false;

  protected readonly types = computed(() => ACCOUNT_TYPES.map((type) => ({ value: type, label: accountTypeLabel(type) })));
  protected readonly type = signal<AccountType>('banco');
  protected readonly name = signal('');
  /** Saldo de hoy; en una tarjeta, lo que se debe (en positivo). */
  protected readonly balance = signal('');
  protected readonly creditLimit = signal('');
  protected readonly cutDay = signal('');
  protected readonly dueDay = signal('');
  /** Últimos 4 dígitos de la tarjeta, para reconocerla. */
  protected readonly cardLast4 = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly currency = inject(CurrencyState).currency;
  protected readonly isEdit = signal(false);
  protected readonly isCash = signal(false);
  protected readonly isCard = computed(() => isCard({ type: this.type() }));

  protected readonly canSave = computed(() => this.name().trim() !== '' && parseBalance(this.balance()) !== null && !this.saving());

  constructor() {
    addIcons({ close });
  }

  ngOnInit() {
    const v = this.view;
    if (!v) {
      if (this.presetType) this.type.set(this.presetType);
      return;
    }
    const a = v.account;
    this.isEdit.set(true);
    this.isCash.set(a.id === CASH_ACCOUNT_ID);
    this.type.set(a.type);
    this.name.set(a.name);
    this.balance.set(amountToInput(isCard(a) ? -v.balance : v.balance));
    if (a.creditLimit) this.creditLimit.set(amountToInput(a.creditLimit));
    if (a.cutDay) this.cutDay.set(String(a.cutDay));
    if (a.dueDay) this.dueDay.set(String(a.dueDay));
    this.cardLast4.set(a.cardLast4 ?? '');
  }

  protected cancel() {
    return this.modalCtrl.dismiss(null, 'cancel');
  }

  protected async save() {
    const typed = parseBalance(this.balance()) ?? 0;
    // En una tarjeta el saldo es lo que se debe: se guarda en negativo.
    const balance = this.isCard() ? -typed : typed;
    const fields = {
      name: this.name(),
      type: this.type(),
      initialBalance: this.view?.account.initialBalance ?? balance,
      creditLimit: parseAmount(this.creditLimit()),
      cutDay: this.cutDay() ? Number(this.cutDay()) : null,
      dueDay: this.dueDay() ? Number(this.dueDay()) : null,
      cardLast4: this.cardLast4(),
    };
    if (this.draft) {
      await this.modalCtrl.dismiss({ ...fields, initialBalance: balance }, 'draft');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const account = await this.container.saveAccount.execute(fields, this.view?.account.id);
      // Al editar, un saldo distinto del calculado queda como un ajuste visible en Movimientos (no es ingreso ni gasto).
      if (this.view && balance !== this.view.balance) {
        await this.container.adjustAccountBalance.execute(account.id, balance, todayIso());
      }
      this.saved.set(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_VISIBLE_MS));
      await this.modalCtrl.dismiss(null, 'saved');
    } catch (e) {
      this.error.set(errorText(e, 'common.saveFailed'));
      this.saving.set(false);
    }
  }

  protected async toggleArchived() {
    const a = this.view?.account;
    if (!a) return;
    await this.run(() => this.container.archiveAccount.execute(a.id, !a.archived));
  }

  protected async confirmDelete() {
    const a = this.view?.account;
    if (!a) return;
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('cuenta.delete'),
      message: t('cuenta.deleteMsg', { name: a.name }),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.delete'), role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    await this.run(() => this.container.deleteAccount.execute(a.id));
  }

  private async run(work: () => Promise<unknown>) {
    this.saving.set(true);
    this.error.set(null);
    try {
      await work();
      await this.modalCtrl.dismiss(null, 'saved');
    } catch (e) {
      this.error.set(errorText(e, 'common.saveFailed'));
      this.saving.set(false);
    }
  }
}
