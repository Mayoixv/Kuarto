import { Component, computed, inject, Input, OnInit, signal } from '@angular/core';
import { DateFieldComponent } from '../select/date-field.component';
import { SelectFieldComponent } from '../select/select-field.component';
import { AlertController, IonContent, IonIcon, IonInput, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close, swapVertical } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Account, arrivingAmount, currencyOf, isCard, Transfer } from '../../domain/account';
import { convertCents } from '../../domain/currency';
import { ExchangeRateService } from '../exchange-rate.service';
import { UndoService } from '../undo.service';
import { CurrencyState } from '../currency-state';
import { amountToInput, formatAccountMoney, parseAmount, todayIso } from '../format';
import { SuccessCheckComponent } from '../success-check.component';
import { accountOptions } from './account-choices';
import { t, errorText } from '../i18n';

/** Cuánto se ve el check de éxito antes de cerrar (design.md, 10.2). */
const SUCCESS_VISIBLE_MS = 1200;

@Component({
  selector: 'app-transferencia-modal',
  templateUrl: 'transferencia.modal.html',
  styleUrls: ['transferencia.modal.scss'],
  imports: [DateFieldComponent, SelectFieldComponent, IonContent, IonIcon, IonInput, SuccessCheckComponent],
})
export class TransferenciaModalComponent implements OnInit {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  private readonly alerts = inject(AlertController);
  private readonly undo = inject(UndoService);

  /** Para "Pagar" desde una tarjeta: la tarjeta de destino y lo que falta del estado. */
  @Input() toAccountId?: string;
  @Input() suggestedAmount?: number;
  /** Si llega, el formulario edita esta transferencia (y permite borrarla). */
  @Input() transfer?: Transfer;

  protected readonly accounts = signal<Account[]>([]);
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);
  protected readonly amount = signal('');
  protected readonly date = signal(todayIso());
  protected readonly note = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  private readonly mainCurrency = inject(CurrencyState).currency;
  private readonly rates = inject(ExchangeRateService);
  protected readonly money = formatAccountMoney;
  protected readonly amountToInput = amountToInput;
  /** Entre cuentas de distinta moneda: lo que llega a la de destino. Vacío = lo que da la tasa del día. */
  protected readonly toAmount = signal('');
  /** Saldo de cada cuenta sin esta transferencia (al editar se descuenta lo que ya movía). */
  private readonly balances = signal(new Map<string, number>());
  protected readonly accountOptions = computed(() => accountOptions(this.accounts()));
  private readonly fromAccount = computed(() => this.accounts().find((a) => a.id === this.from()));
  private readonly toAccount = computed(() => this.accounts().find((a) => a.id === this.to()));
  /** Moneda de la cuenta de origen: en ella se escribe el monto. */
  protected readonly currency = computed(() => currencyOf(this.fromAccount(), this.mainCurrency()));
  protected readonly toCurrency = computed(() => currencyOf(this.toAccount(), this.mainCurrency()));
  protected readonly crossCurrency = computed(() => !!this.toAccount() && this.currency() !== this.toCurrency());
  /** Lo que llegaría con la tasa del día; null sin tasa o sin monto. */
  protected readonly suggestedToAmount = computed(() => {
    const amount = parseAmount(this.amount());
    const rate = this.rates.rate();
    return this.crossCurrency() && amount !== null && rate ? convertCents(amount, this.currency(), rate.usdToDop) : null;
  });
  private readonly arriving = computed(() =>
    this.crossCurrency() ? (parseAmount(this.toAmount()) ?? this.suggestedToAmount()) : parseAmount(this.amount()),
  );
  protected readonly rateText = computed(() => this.rates.rateText());

  /** Cómo quedan las dos cuentas, para ver antes de guardar que el dinero va en la dirección correcta. */
  protected readonly preview = computed(() => {
    const from = this.fromAccount();
    const to = this.toAccount();
    const amount = parseAmount(this.amount());
    const arriving = this.arriving();
    if (!from || !to || from.id === to.id || amount === null || arriving === null) return null;
    const before = (a: Account) => this.balances().get(a.id) ?? a.initialBalance;
    return [
      { account: from, name: from.name, before: before(from), after: before(from) - amount },
      { account: to, name: to.name, before: before(to), after: before(to) + arriving },
    ];
  });

  /** No bloquea (puede ser un sobregiro real), pero avisa: casi siempre es que se eligieron al revés. */
  protected readonly warning = computed(() => {
    const out = this.preview()?.[0];
    if (!out || isCard(out.account) || out.after >= 0) return null;
    return t('transfer.warning', { name: out.name, amount: formatAccountMoney(out.after, out.account) });
  });
  protected readonly toOptions = computed(() => this.accountOptions().filter((o) => o.value !== this.from()));

  /** Pagar una tarjeta es una transferencia hacia ella: se dice así para que se entienda. */
  protected readonly isCardPayment = computed(() => {
    const to = this.accounts().find((a) => a.id === this.to());
    return !!to && isCard(to);
  });

  protected readonly canSave = computed(
    () =>
      !!this.from() &&
      !!this.to() &&
      this.from() !== this.to() &&
      parseAmount(this.amount()) !== null &&
      this.arriving() !== null &&
      !this.saving(),
  );

  constructor() {
    addIcons({ close, swapVertical });
  }

  async ngOnInit() {
    const tr = this.transfer;
    // Al editar, también las cuentas archivadas que use la transferencia.
    const active = (await this.container.accounts.list()).filter(
      (a) => !a.archived || a.id === tr?.fromAccountId || a.id === tr?.toAccountId,
    );
    this.accounts.set(active);
    const balances = await this.container.accounts.balances();
    if (tr) {
      balances.set(tr.fromAccountId, (balances.get(tr.fromAccountId) ?? 0) + tr.amount);
      balances.set(tr.toAccountId, (balances.get(tr.toAccountId) ?? 0) - arrivingAmount(tr));
    }
    this.balances.set(balances);
    if (tr) {
      this.from.set(tr.fromAccountId);
      this.to.set(tr.toAccountId);
      this.amount.set(amountToInput(tr.amount));
      if (tr.toAmount) this.toAmount.set(amountToInput(tr.toAmount));
      this.date.set(tr.date);
      this.note.set(tr.note);
      return;
    }
    this.from.set(active.find((a) => !isCard(a))?.id ?? null);
    if (this.toAccountId) this.to.set(this.toAccountId);
    if (!this.suggestedAmount) return;
    const rate = this.rates.rate();
    if (this.crossCurrency()) {
      // Lo que falta de la tarjeta va en su moneda: es lo que debe llegar; lo que sale se propone con la tasa del día.
      this.toAmount.set(amountToInput(this.suggestedAmount));
      if (rate) this.amount.set(amountToInput(convertCents(this.suggestedAmount, this.toCurrency(), rate.usdToDop)));
    } else {
      this.amount.set(amountToInput(this.suggestedAmount));
    }
  }

  protected async confirmDelete() {
    const tr = this.transfer;
    if (!tr) return;
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('transfer.delete'),
      message: t('transfer.deleteMsg'),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.delete'), role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    this.saving.set(true);
    try {
      const removed = await this.container.deleteTransfer.execute(tr.id);
      if (removed) this.undo.offer(t('transfer.deleted'), () => this.container.accounts.saveTransfer(removed));
      await this.modalCtrl.dismiss(null, 'deleted');
    } catch (e) {
      console.error(e);
      this.error.set(t('common.deleteFailed'));
      this.saving.set(false);
    }
  }

  protected swap() {
    const from = this.from();
    this.from.set(this.to());
    this.to.set(from);
  }

  protected cancel() {
    return this.modalCtrl.dismiss(null, 'cancel');
  }

  protected async save() {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.container.saveTransfer.execute({
        date: this.date(),
        amount: parseAmount(this.amount()) ?? 0,
        fromAccountId: this.from()!,
        toAccountId: this.to()!,
        note: this.note(),
        toAmount: this.crossCurrency() ? this.arriving() : null,
      }, this.transfer?.id);
      this.saved.set(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_VISIBLE_MS));
      await this.modalCtrl.dismiss(null, 'saved');
    } catch (e) {
      this.error.set(errorText(e, 'common.saveFailed'));
      this.saving.set(false);
    }
  }
}
