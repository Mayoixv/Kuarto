import { Component, computed, inject, Input, signal } from '@angular/core';
import { Account, CASH_ACCOUNT_ID } from '../../domain/account';
import { accountChoices, accountOptions, rememberAccount } from '../cuentas/account-choices';
import { SelectFieldComponent } from '../select/select-field.component';
import { DateFieldComponent } from '../select/date-field.component';
import { IonContent, IonIcon, IonInput, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { SavingsGoal } from '../../domain/savings';
import { CurrencyState } from '../currency-state';
import { defaultDateFor, parseAmount } from '../format';
import { MonthState } from '../month-state';
import { SuccessCheckComponent } from '../success-check.component';
import { t, errorText } from '../i18n';

/** Cuánto se ve el check de éxito antes de cerrar (design.md, 10.2). */
const SUCCESS_VISIBLE_MS = 1200;

@Component({
  selector: 'app-aporte-modal',
  templateUrl: 'aporte.modal.html',
  styleUrls: ['aporte.modal.scss'],
  imports: [DateFieldComponent, SelectFieldComponent, IonContent, IonIcon, IonInput, SuccessCheckComponent],
})
export class AporteModalComponent {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  private readonly monthState = inject(MonthState);

  @Input({ required: true }) goal!: SavingsGoal;
  /** Sacar dinero de la meta en vez de aportar. */
  @Input() withdrawal = false;

  protected readonly amount = signal('');
  protected readonly date = signal(defaultDateFor(this.monthState.month()));
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly currency = inject(CurrencyState).currency;
  protected readonly accounts = signal<Account[]>([]);
  protected readonly accountId = signal(CASH_ACCOUNT_ID);
  protected readonly accountOptions = computed(() => accountOptions(this.accounts()));

  protected readonly canSave = computed(() => parseAmount(this.amount()) !== null && !this.saving());

  constructor() {
    addIcons({ close });
    accountChoices(this.container, null, true).then(({ accounts, selected }) => {
      this.accounts.set(accounts);
      this.accountId.set(selected);
    }, console.error);
  }

  protected cancel() {
    return this.modalCtrl.dismiss(null, 'cancel');
  }

  protected async save() {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.container.addSavingsContribution.execute({
        goalId: this.goal.id,
        date: this.date(),
        amount: parseAmount(this.amount()) ?? 0,
        withdrawal: this.withdrawal,
        accountId: this.accountId(),
      });
      await rememberAccount(this.container, this.accountId());
      this.saved.set(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_VISIBLE_MS));
      await this.modalCtrl.dismiss(null, 'saved');
    } catch (e) {
      this.error.set(
        errorText(e, 'common.saveFailed'),
      );
      this.saving.set(false);
    }
  }
}
