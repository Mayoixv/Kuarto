import { possibleDuplicates, priceChange, unusualSpending } from '../../domain/insights';
import { Cents } from '../../domain/money';
import { addMonths, IsoDate, monthOf } from '../../domain/month';
import { expandSplits, Transaction } from '../../domain/transaction';
import { ICategoryRepository, IRecurringExpenseRepository, ITransactionRepository } from '../ports/repositories';
import { CanAfford } from './can-afford';

/** Meses anteriores que se usan de costumbre para el gasto inusual. */
const HISTORY_MONTHS = 3;

export interface Insights {
  /** Fijos cuyo último pago (este mes o el anterior) cambió de precio frente al anterior. */
  priceChanges: { name: string; from: Cents; to: Cents }[];
  /** Grupos de movimientos del mes que parecen repetidos. */
  duplicates: number;
  /** Categorías variables con bastante más gasto que de costumbre este mes. */
  unusual: { name: string; current: Cents; average: Cents }[];
  /** Primer día en que tus cuentas quedarían en negativo por pagos con fecha (sin contar gasto diario). */
  shortfall: { date: IsoDate; label: string | null } | null;
  /** Lo que queda libre por día del dinero del mes, después de lo pendiente. */
  perDay: Cents;
  days: number;
}

/** Avisos que se sacan de los datos: precios que cambian, duplicados, gastos raros y saldos que no alcanzan. */
export class GetInsights {
  constructor(
    private readonly recurring: IRecurringExpenseRepository,
    /** En la moneda principal, para comparar meses con cuentas en distintas monedas. */
    private readonly transactions: ITransactionRepository,
    private readonly categories: ICategoryRepository,
    private readonly afford: CanAfford,
  ) {}

  async execute(today: IsoDate): Promise<Insights> {
    const month = monthOf(today);
    const history = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(month, -(i + 1)));
    const [expenses, categories, current, past, outlook] = await Promise.all([
      this.recurring.list(),
      this.categories.list(),
      this.transactions.listByMonth(month),
      Promise.all(history.map((m) => this.transactions.listByMonth(m))),
      this.afford.outlook(today),
    ]);
    const priceChanges: Insights['priceChanges'] = [];
    for (const expense of expenses.filter((e) => e.active)) {
      const instances = await this.recurring.listInstancesOf(expense.id);
      const lastPaid = instances.filter((i) => i.status === 'pagado').map((i) => i.month).sort().at(-1);
      const change = lastPaid && lastPaid >= addMonths(month, -1) ? priceChange(instances) : null;
      if (change) priceChanges.push({ name: expense.name, ...change });
    }
    const variable = new Set(categories.filter((c) => c.type === 'variable').map((c) => c.id));
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const byCategory = (list: Transaction[]) => {
      const out = new Map<string, Cents>();
      for (const t of expandSplits(list)) if (variable.has(t.categoryId)) out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + t.amount);
      return out;
    };
    return {
      priceChanges,
      duplicates: possibleDuplicates(current).length,
      unusual: unusualSpending(byCategory(current), past.map(byCategory)).map((u) => ({
        name: names.get(u.categoryId) ?? '',
        current: u.current,
        average: u.average,
      })),
      shortfall: outlook.shortfall,
      perDay: outlook.perDay,
      days: outlook.days,
    };
  }
}
