import { CategoryType, isExpenseType } from '../../domain/category';
import { expenseBreakdown } from '../../domain/expense-breakdown';
import { SpendingGroup, spendingByNote, spendingByTag } from '../../domain/spending-groups';
import { Transaction } from '../../domain/transaction';
import { addMonths, dateInMonth, daysInMonth, MonthKey } from '../../domain/month';
import { MonthlySummary, summarizeMonth } from '../../domain/monthly-summary';
import {
  IAccountRepository,
  ICategoryRepository,
  ISavingsRepository,
  ITransactionRepository,
} from '../ports/repositories';
import { GetMonthRecurringExpenses } from './get-month-recurring-expenses';
import { LoadMoneyConverter, MoneyConverter } from './money-converter';

export interface CategoryTrend {
  categoryId: string;
  name: string;
  /** Total del periodo. */
  total: number;
  /** Gasto de cada mes del periodo, del más antiguo al más reciente. */
  byMonth: number[];
}

export interface Projection {
  /** Balance del mes hasta hoy. */
  current: number;
  pendingIncome: number;
  pendingExpenses: number;
  /** Balance al cierre si se cobran y pagan todos los fijos pendientes. */
  projected: number;
}

export interface Report {
  /** Meses del periodo, del más antiguo al más reciente. */
  months: MonthKey[];
  summaries: MonthlySummary[];
  /** Categorías de gasto con algo en el periodo, de mayor a menor. */
  categories: CategoryTrend[];
  /** Suma de los saldos de todas las cuentas (tarjetas en negativo) al cierre de cada mes. */
  accountsAtClose: number[];
  /** Solo si el periodo termina en el mes en curso. */
  projection: Projection | null;
  /** Gasto del periodo por etiqueta y por comercio (la nota), de mayor a menor. */
  byTag: SpendingGroup[];
  byMerchant: SpendingGroup[];
}

/** Datos de la pantalla de reportes para los `count` meses que terminan en `endMonth`. */
export class GetReport {
  constructor(
    private readonly transactions: ITransactionRepository,
    private readonly categories: ICategoryRepository,
    private readonly savings: ISavingsRepository,
    private readonly accounts: IAccountRepository,
    private readonly recurring: GetMonthRecurringExpenses,
    private readonly converter: Pick<LoadMoneyConverter, 'execute'> = { execute: async () => MoneyConverter.identity() },
  ) {}

  async execute(endMonth: MonthKey, requested: number, currentMonth: MonthKey): Promise<Report> {
    const count = Math.max(1, Math.floor(requested) || 1);
    const months = Array.from({ length: count }, (_, i) => addMonths(endMonth, i - count + 1));
    const [categories, converter] = await Promise.all([this.categories.list(), this.converter.execute()]);
    const perMonth = await Promise.all(
      months.map(async (m) => {
        const [transactions, contributions, balances] = await Promise.all([
          this.transactions.listByMonth(m),
          this.savings.listContributionsByMonth(m),
          this.accounts.balances(dateInMonth(m, daysInMonth(m))),
        ]);
        return {
          transactions,
          summary: summarizeMonth(m, transactions, categories, contributions),
          slices: expenseBreakdown(m, transactions, categories),
          accounts: [...balances].reduce((s, [id, b]) => s + converter.ofAccount(b, id), 0),
        };
      }),
    );

    const trends = new Map<string, CategoryTrend>();
    perMonth.forEach(({ slices }, i) => {
      for (const s of slices) {
        const trend = trends.get(s.categoryId) ?? { categoryId: s.categoryId, name: s.name, total: 0, byMonth: months.map(() => 0) };
        trend.byMonth[i] += s.amount;
        trend.total += s.amount;
        trends.set(s.categoryId, trend);
      }
    });

    return {
      months,
      summaries: perMonth.map((p) => p.summary),
      categories: [...trends.values()].sort((a, b) => b.total - a.total),
      accountsAtClose: perMonth.map((p) => p.accounts),
      projection: endMonth === currentMonth ? await this.project(perMonth.at(-1)!.summary, categories, endMonth) : null,
      ...this.groups(perMonth.flatMap((p) => p.transactions), categories),
    };
  }

  private groups(all: Transaction[], categories: { id: string; type: CategoryType }[]) {
    const expense = new Set(categories.filter((c) => isExpenseType(c.type)).map((c) => c.id));
    const isExpense = (id: string) => expense.has(id);
    return { byTag: spendingByTag(all, isExpense), byMerchant: spendingByNote(all, isExpense) };
  }

  private async project(summary: MonthlySummary, categories: { id: string; type: string }[], month: MonthKey): Promise<Projection> {
    const income = new Set(categories.filter((c) => c.type === 'ingreso').map((c) => c.id));
    const pending = (await this.recurring.execute(month)).filter((i) => i.instance.status === 'pendiente');
    const pendingIncome = pending.filter((i) => income.has(i.expense.categoryId)).reduce((s, i) => s + i.instance.amount, 0);
    const pendingExpenses = pending.filter((i) => !income.has(i.expense.categoryId)).reduce((s, i) => s + i.instance.amount, 0);
    return {
      current: summary.balance,
      pendingIncome,
      pendingExpenses,
      projected: summary.balance + pendingIncome - pendingExpenses,
    };
  }
}
