import { Account } from '../../domain/account';
import { Cents } from '../../domain/money';
import { dateInMonth, daysInMonth, IsoDate, MonthKey, monthOf } from '../../domain/month';
import { expandSplits } from '../../domain/transaction';
import { ICategoryRepository, ITransactionRepository } from '../ports/repositories';
import { GetCardStatuses } from './accounts';
import { GetDebtInstallments } from './get-debt-installments';
import { GetMonthRecurringExpenses } from './get-month-recurring-expenses';

export type CalendarKind = 'pago' | 'cobro' | 'tarjeta' | 'cuota';
export type CalendarStatus = 'hecho' | 'pendiente' | 'vencido';

export interface CalendarEvent {
  kind: CalendarKind;
  label: string;
  amount: Cents;
  status: CalendarStatus;
  /** Solo tarjetas: su monto va en la moneda de la tarjeta. */
  account?: Account;
}

export interface CalendarDay {
  date: IsoDate;
  events: CalendarEvent[];
  /** Lo gastado y cobrado ese día según Movimientos, en la moneda principal. */
  spent: Cents;
  earned: Cents;
}

/**
 * El mes día por día, como el calendario de recurrentes de Monarch o la vista de calendario de Money Manager: fijos
 * por pagar o cobrar, el pago de las tarjetas, las cuotas de deudas y lo que se movió cada día.
 */
export class GetMonthCalendar {
  constructor(
    private readonly recurring: GetMonthRecurringExpenses,
    private readonly cards: GetCardStatuses,
    private readonly installments: GetDebtInstallments,
    /** En la moneda principal. */
    private readonly transactions: ITransactionRepository,
    private readonly categories: ICategoryRepository,
  ) {}

  async execute(month: MonthKey, today: IsoDate): Promise<CalendarDay[]> {
    const [items, cards, debts, transactions, categories] = await Promise.all([
      this.recurring.execute(month),
      this.cards.execute(today),
      this.installments.execute(month),
      this.transactions.listByMonth(month),
      this.categories.list(),
    ]);
    const days: CalendarDay[] = Array.from({ length: daysInMonth(month) }, (_, i) => ({
      date: dateInMonth(month, i + 1),
      events: [],
      spent: 0,
      earned: 0,
    }));
    const at = (date: IsoDate) => days[Number(date.slice(8, 10)) - 1];
    const status = (done: boolean, date: IsoDate): CalendarStatus => (done ? 'hecho' : date < today ? 'vencido' : 'pendiente');
    const type = new Map(categories.map((c) => [c.id, c.type]));

    for (const { expense, instance } of items) {
      at(instance.dueDate).events.push({
        kind: type.get(expense.categoryId) === 'ingreso' ? 'cobro' : 'pago',
        label: expense.name,
        amount: instance.amount,
        status: status(instance.status === 'pagado', instance.dueDate),
      });
    }
    // La tarjeta se muestra en su fecha límite si cae en este mes y queda algo del estado por pagar.
    for (const c of cards) {
      if (monthOf(c.dueDate) !== month || c.pending <= 0) continue;
      at(c.dueDate).events.push({ kind: 'tarjeta', label: c.account.name, amount: c.pending, status: status(false, c.dueDate), account: c.account });
    }
    for (const d of debts) {
      at(d.dueDate).events.push({ kind: 'cuota', label: d.view.debt.name, amount: d.amount, status: status(d.paid, d.dueDate) });
    }
    for (const t of expandSplits(transactions)) {
      const day = at(t.date);
      if (type.get(t.categoryId) === 'ingreso') day.earned += t.amount;
      else day.spent += t.amount;
    }
    for (const d of days) d.events.sort((a, b) => b.amount - a.amount);
    return days;
  }
}
