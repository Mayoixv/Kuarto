import { TiltDirective } from '../tilt.directive';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AlertController, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, chevronForward, swapHorizontal } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { AccountView, CardStatus } from '../../application/use-cases/accounts';
import {
  Account,
  AccountType,
  CARD_UTILIZATION_WARNING,
  isCard,
  Transfer,
} from '../../domain/account';
import { adjustmentText, DineroFormService } from '../dinero/dinero-form.service';
import { adjustmentOf } from '../../domain/account';
import {
  amountToInput,
  currentMonth,
  formatDay,
  formatMoney,
  formatPercent,
  monthLabel,
  parseAmount,
  todayIso,
} from '../format';
import { MonthState } from '../month-state';
import { accountTypeLabel } from './account-choices';
import { LoadingComponent } from '../loading.component';
import { t } from '../i18n';

interface Row {
  view: AccountView;
  name: string;
  detail: string;
  balance: string;
  negative: boolean;
  /** Solo tarjetas: estado del último corte. */
  status?: CardStatus;
  statusText?: string;
  urgent?: boolean;
  highUse?: boolean;
  /** Solo tarjetas, para dibujarlas como tarjeta física. */
  card?: {
    last4: string | null;
    /** Porcentaje del límite usado (0–100) para la barra. */
    usedPercent: number | null;
    usedText: string | null;
    days: string;
  };
}

type GroupKey = 'cuentas' | 'efectivo' | 'tarjetas';

interface Group {
  key: GroupKey;
  title: string;
  /** Saldo del grupo; en tarjetas, lo que se debe. */
  total: string;
  rows: Row[];
  addLabel: string;
  addType: AccountType;
  empty: string;
}

const groupText = (key: GroupKey) => ({
  title: t(`cuentas.groups.${key}.title`),
  addLabel: t(`cuentas.groups.${key}.add`),
  empty: t(`cuentas.groups.${key}.empty`),
});

const groupOf = (a: Account): GroupKey => (isCard(a) ? 'tarjetas' : a.type === 'efectivo' ? 'efectivo' : 'cuentas');

/** Contenido de la pestaña Dinero: Cuentas, Efectivo y Tarjetas, cada grupo con su total y su botón de agregar. */
@Component({
  selector: 'app-cuentas-view',
  templateUrl: 'cuentas-view.component.html',
  styleUrls: ['cuentas-view.component.scss'],
  imports: [LoadingComponent, IonIcon, TiltDirective],
})
export class CuentasViewComponent {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  protected readonly forms = inject(DineroFormService);
  private readonly alerts = inject(AlertController);
  protected readonly monthState = inject(MonthState);

  /** Grupo al que llevar la vista al abrir (`?ver=tarjetas` desde alertas y notificaciones). */
  readonly focus = input<string>();

  private readonly views = signal<AccountView[] | null>(null);
  protected readonly transfers = signal<Transfer[]>([]);
  private readonly cardStatuses = signal<CardStatus[]>([]);
  protected readonly failed = signal(false);
  protected readonly showArchived = signal(false);
  protected readonly liveMessage = signal('');
  protected readonly money = formatMoney;
  protected readonly day = formatDay;
  protected readonly min = Math.min;
  protected readonly monthName = () => monthLabel(currentMonth());

  protected readonly loaded = computed(() => this.views() !== null);
  protected readonly groups = computed<Group[]>(() => {
    const statuses = new Map(this.cardStatuses().map((c) => [c.account.id, c]));
    const active = (this.views() ?? []).filter((v) => !v.account.archived);
    const of = (key: GroupKey) => active.filter((v) => groupOf(v.account) === key);
    const sum = (key: GroupKey) => of(key).reduce((t, v) => t + v.balance, 0);
    const rows = (key: GroupKey) => of(key).map((v) => withStatus(toRow(v), statuses.get(v.account.id)));
    return [
      { key: 'cuentas', ...groupText('cuentas'), total: formatMoney(sum('cuentas')), rows: rows('cuentas'), addType: 'banco' },
      { key: 'efectivo', ...groupText('efectivo'), total: formatMoney(sum('efectivo')), rows: rows('efectivo'), addType: 'efectivo' },
      {
        key: 'tarjetas',
        ...groupText('tarjetas'),
        total: t('cuentas.owesAmount', { amount: formatMoney(Math.max(0, -sum('tarjetas'))) }),
        rows: rows('tarjetas'),
        addType: 'tarjeta',
      },
    ];
  });
  protected readonly archived = computed(() =>
    (this.views() ?? [])
      .filter((v) => v.account.archived)
      .map(toRow),
  );
  protected readonly canTransfer = computed(
    () => (this.views() ?? []).filter((v) => !v.account.archived).length > 1,
  );
  private readonly names = computed(
    () =>
      new Map((this.views() ?? []).map((v) => [v.account.id, v.account.name])),
  );

  constructor() {
    addIcons({ add, chevronForward, swapHorizontal });
    effect(() => {
      this.monthState.version();
      this.load();
    });
  }

  protected transferText(transfer: Transfer): string {
    const n = this.names();
    const adjustment = adjustmentText(transfer, n);
    if (adjustment) return adjustment.title;
    return `${n.get(transfer.fromAccountId) ?? t('cuentas.account')} → ${n.get(transfer.toAccountId) ?? t('cuentas.account')}`;
  }

  protected readonly isAdjustment = (transfer: Transfer) => !!adjustmentOf(transfer);

  protected transferAmount(transfer: Transfer): string {
    return adjustmentText(transfer, this.names())?.amount ?? formatMoney(transfer.amount);
  }

  protected openAccount(view: AccountView) {
    return this.forms.openAccount(view);
  }

  protected addAccount(type: AccountType) {
    return this.forms.openAccount(undefined, type);
  }

  protected openTransfer() {
    return this.forms.openTransfer();
  }

  protected payCard(r: Row) {
    return this.forms.openTransfer(
      r.view.account.id,
      r.status?.pending || r.status?.currentDebt,
    );
  }

  /** El pago mínimo lo fija el banco en cada estado: se anota a mano y vale solo para ese corte. */
  protected async askMinimum(r: Row) {
    const status = r.status;
    if (!status) return;
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('cuentas.minTitle'),
      message: t('cuentas.minMsg', { name: r.name, date: formatDay(status.lastCut) }),
      inputs: [
        {
          name: 'min',
          type: 'number',
          placeholder: '0.00',
          value: status.minimum ? amountToInput(status.minimum) : '',
          attributes: { inputmode: 'decimal', min: 0 },
        },
      ],
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.save'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm') return;
    const text = String(data?.values?.min ?? '').trim();
    const amount = text ? parseAmount(text) : null;
    if (text && amount === null) {
      this.liveMessage.set(t('cuentas.invalidAmount'));
      return;
    }
    try {
      await this.container.setCardMinimum.execute(
        r.view.account.id,
        status.lastCut,
        amount,
      );
      this.monthState.notifyChange();
    } catch (error) {
      console.error(error);
      this.liveMessage.set(t('cuentas.minFailed'));
    }
  }

  private async load() {
    try {
      const [overview, transfers, cards] = await Promise.all([
        this.container.getAccountsOverview.execute(),
        this.container.accounts.listTransfers(currentMonth()),
        this.container.getCardStatuses.execute(todayIso()),
      ]);
      this.cardStatuses.set(cards);
      this.transfers.set(transfers);
      this.views.set(overview.accounts);
      this.failed.set(false);
      const focus = this.focus();
      if (focus) setTimeout(() => document.getElementById('grupo-' + focus)?.scrollIntoView({ block: 'start' }));
    } catch (error) {
      console.error(error);
      this.failed.set(true);
    }
  }
}

function toRow(view: AccountView): Row {
  const a = view.account;
  let detail = accountTypeLabel(a.type);
  if (isCard(a) && a.creditLimit) {
    const used = Math.max(0, -view.balance);
    detail = t('cuentas.usedOf', { percent: formatPercent((used / a.creditLimit) * 100), limit: formatMoney(a.creditLimit), cut: a.cutDay ?? '', due: a.dueDay ?? '' });
  }
  const owed = Math.max(0, -view.balance);
  const card = isCard(a)
    ? {
        last4: a.cardLast4 ?? null,
        usedPercent: a.creditLimit ? Math.min(100, (owed / a.creditLimit) * 100) : null,
        usedText: a.creditLimit ? t('cuentas.usedShort', { percent: formatPercent((owed / a.creditLimit) * 100), limit: formatMoney(a.creditLimit) }) : null,
        days: t('cuentas.days', { cut: a.cutDay ?? '', due: a.dueDay ?? '' }),
      }
    : undefined;
  return {
    view,
    card,
    name: a.name,
    detail,
    // En una tarjeta se muestra lo que se debe, sin signo.
    balance: formatMoney(isCard(a) ? Math.max(0, -view.balance) : view.balance),
    negative: !isCard(a) && view.balance < 0,
  };
}

function withStatus(row: Row, status: CardStatus | undefined): Row {
  if (!status) return row;
  const cut = formatDay(status.lastCut);
  const due = formatDay(status.dueDate);
  const amount = formatMoney(status.pending);
  let statusText: string;
  if (status.statementDebt === 0) statusText = t('cuentas.nothingToPay', { cut });
  else if (status.pending === 0) statusText = t('cuentas.statementPaid', { cut });
  else if (status.daysToDue < 0) statusText = t('cuentas.overdue', { due, amount, cut });
  else statusText = t('cuentas.payBefore', { amount, due, cut });
  if (status.cycleCharges > 0) statusText += t('cuentas.newCharges', { amount: formatMoney(status.cycleCharges) });
  return {
    ...row,
    status,
    statusText,
    urgent: status.pending > 0 && status.daysToDue <= 3,
    highUse: (status.utilization ?? 0) >= CARD_UTILIZATION_WARNING,
  };
}
