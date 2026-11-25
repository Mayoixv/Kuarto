import { Component, computed, inject, Input, OnInit, signal } from '@angular/core';
import { AlertController, IonContent, IonIcon, IonInput, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Account } from '../../domain/account';
import { Category } from '../../domain/category';
import { CategoryRule, RULE_MAX_LENGTH } from '../../domain/rules';
import { accountLabel } from '../cuentas/account-choices';
import { CategoryFieldComponent } from '../select/category-field.component';
import { SelectFieldComponent } from '../select/select-field.component';
import { SuccessCheckComponent } from '../success-check.component';
import { errorText, t, tn } from '../i18n';

/** Cuánto se ve el check de éxito antes de cerrar (design.md, 10.2). */
const SUCCESS_VISIBLE_MS = 1200;
/** Valor de "no cambiar la cuenta" en el selector (app-select-field no admite null como opción). */
const NO_ACCOUNT = '';

/** Crear o editar una regla automática: "si la nota contiene… va a…". */
@Component({
  selector: 'app-regla-modal',
  templateUrl: 'regla.modal.html',
  styleUrls: ['../cuentas/cuenta.modal.scss'],
  imports: [CategoryFieldComponent, SelectFieldComponent, IonContent, IonIcon, IonInput, SuccessCheckComponent],
})
export class ReglaModalComponent implements OnInit {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  private readonly alerts = inject(AlertController);

  @Input() rule?: CategoryRule;
  /** Texto propuesto al crear (desde un movimiento). */
  @Input() presetMatch?: string;
  @Input() presetCategoryId?: string;

  protected readonly maxLength = RULE_MAX_LENGTH;
  protected readonly categories = signal<Category[]>([]);
  private readonly accounts = signal<Account[]>([]);
  protected readonly match = signal('');
  protected readonly categoryId = signal<string | null>(null);
  protected readonly accountId = signal<string>(NO_ACCOUNT);
  protected readonly tag = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly doneText = signal('');

  protected readonly accountOptions = computed(() => [
    { value: NO_ACCOUNT, label: t('reglas.noAccount') },
    ...this.accounts()
      .filter((a) => !a.archived || a.id === this.rule?.accountId)
      .map((a) => ({ value: a.id, label: accountLabel(a) })),
  ]);
  protected readonly canSave = computed(() => this.match().trim().length >= 2 && !!this.categoryId() && !this.saving());

  constructor() {
    addIcons({ close });
  }

  async ngOnInit() {
    const [categories, accounts] = await Promise.all([this.container.categories.list(), this.container.accounts.list()]);
    this.categories.set(categories);
    this.accounts.set(accounts);
    const r = this.rule;
    this.match.set(r?.match ?? this.presetMatch ?? '');
    this.categoryId.set(r?.categoryId ?? this.presetCategoryId ?? null);
    this.accountId.set(r?.accountId ?? NO_ACCOUNT);
    this.tag.set(r?.tag ?? '');
  }

  protected addCategory(category: Category) {
    this.categories.update((list) => [...list, category]);
  }

  protected cancel() {
    return this.modalCtrl.dismiss(null, 'cancel');
  }

  protected async save() {
    this.saving.set(true);
    this.error.set(null);
    try {
      const rule = await this.container.saveCategoryRule.execute(
        { match: this.match(), categoryId: this.categoryId()!, accountId: this.accountId() || null, tag: this.tag() },
        this.rule?.id,
      );
      // Las reglas valen para lo nuevo; para lo que ya existe se pregunta, porque cambia movimientos guardados.
      const changed = (await this.ask(t('reglas.applyTitle'), t('reglas.applyMsg'), t('reglas.apply'), t('reglas.applySkip')))
        ? await this.container.applyRuleToPast.execute(rule.id)
        : null;
      this.doneText.set(changed === null ? t('reglas.saved') : tn('reglas.applied', changed));
      this.saved.set(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_VISIBLE_MS));
      await this.modalCtrl.dismiss(null, 'saved');
    } catch (e) {
      this.error.set(errorText(e, 'common.saveFailed'));
      this.saving.set(false);
    }
  }

  protected async confirmDelete() {
    const r = this.rule;
    if (!r || !(await this.ask(t('reglas.delete'), t('reglas.deleteMsg', { match: r.match }), t('common.delete')))) return;
    this.saving.set(true);
    try {
      await this.container.deleteCategoryRule.execute(r.id);
      await this.modalCtrl.dismiss(null, 'deleted');
    } catch (e) {
      console.error(e);
      this.error.set(t('common.deleteFailed'));
      this.saving.set(false);
    }
  }

  private async ask(header: string, message: string, ok: string, no = t('common.cancel')): Promise<boolean> {
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header,
      message,
      buttons: [
        { text: no, role: 'cancel' },
        { text: ok, role: 'confirm' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'confirm';
  }
}
