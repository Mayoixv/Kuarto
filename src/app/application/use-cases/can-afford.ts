import { Affordability, canAfford, DAYS_INTO_NEXT_MONTH, Income, Outflow } from '../../domain/affordability';
import { Cents } from '../../domain/money';
import { addDays, addMonths, dateInMonth, daysInMonth, IsoDate, monthOf } from '../../domain/month';
import { expandSplits } from '../../domain/transaction';
import { ICategoryRepository, ITransactionRepository } from '../ports/repositories';
import { GetAccountsOverview, GetCardsToPay } from './accounts';
import { GetMonthHistory } from './get-month-history';
import { GetMonthRecurringExpenses } from './get-month-recurring-expenses';

/** Dos respuestas: con el dinero del mes (lo que entró menos lo que salió y se ahorró) y con todo el patrimonio. */
export interface AffordAnswer {
  month: Affordability;
  total: Affordability;
}

/**
 * "¿Me alcanza?" con los datos de hoy: dinero del mes y patrimonio, proyectados día por día con los fijos pendientes,
 * los pagos de tarjeta en su fecha límite y el ritmo de gasto variable de lo que va del mes.
 */
export class CanAfford {
  constructor(
    private readonly history: GetMonthHistory,
    private readonly accounts: GetAccountsOverview,
    private readonly monthItems: GetMonthRecurringExpenses,
    private readonly categories: ICategoryRepository,
    private readonly cards: GetCardsToPay,
    private readonly transactions: ITransactionRepository,
  ) {}

  async execute(amount: Cents, today: IsoDate): Promise<AffordAnswer> {
    const month = monthOf(today);
    const horizon = addDays(dateInMonth(month, daysInMonth(month)), DAYS_INTO_NEXT_MONTH);
    const [[summary], overview, items, next, categories, cards, transactions] = await Promise.all([
      this.history.execute(month, 1),
      this.accounts.execute(),
      this.monthItems.execute(month),
      this.monthItems.execute(addMonths(month, 1)),
      this.categories.list(),
      this.cards.execute(today),
      this.transactions.listByMonth(month),
    ]);
    const type = new Map(categories.map((c) => [c.id, c.type]));
    const pending = [...items, ...next].filter((i) => i.instance.status === 'pendiente' && i.instance.dueDate <= horizon);
    const outflows: Outflow[] = pending
      .filter((i) => type.get(i.expense.categoryId) !== 'ingreso')
      .map((i) => ({ date: i.instance.dueDate, amount: i.instance.amount, label: i.expense.name }));
    for (const c of cards.cards) if (c.dueDate) outflows.push({ date: c.dueDate, amount: c.amount, label: c.account.name });
    const incomes: Income[] = pending
      .filter((i) => type.get(i.expense.categoryId) === 'ingreso')
      .map((i) => ({ date: i.instance.dueDate, amount: i.instance.amount }));
    // Ritmo: lo gastado en categorías variables en lo que va del mes, repartido entre los días transcurridos.
    const variable = expandSplits(transactions)
      .filter((t) => t.date <= today && type.get(t.categoryId) === 'variable')
      .reduce((s, t) => s + t.amount, 0);
    const dailyBurn = Math.trunc(variable / Number(today.slice(8, 10)));

    const input = { outflows, incomes, dailyBurn, today };
    return {
      month: canAfford(amount, { ...input, available: summary.balance }),
      total: canAfford(amount, { ...input, available: overview.assets }),
    };
  }
}
