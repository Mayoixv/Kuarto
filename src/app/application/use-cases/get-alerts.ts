import { CARD_UTILIZATION_WARNING } from '../../domain/account';
import { budgetLevel, budgetName } from '../../domain/budget';
import { daysBetween, IsoDate, monthOf } from '../../domain/month';
import { ICategoryRepository } from '../ports/repositories';
import { GetCardStatuses } from './accounts';
import { GetBudgetStatuses } from './get-budget-statuses';
import { GetUpcomingRecurring } from './get-upcoming-recurring';
import { GetInsights, Insights } from './get-insights';

/** Días hacia adelante en que un fijo pendiente ya cuenta como alerta (como el ámbar de Fijos). */
const DUE_SOON_DAYS = 3;

export interface Alerts {
  /** Gastos fijos pendientes cuya fecha ya pasó, en el mes actual. */
  overdue: string[];
  /** Gastos fijos pendientes que vencen de hoy a 3 días. */
  dueSoon: string[];
  /** Presupuestos pasados del límite. */
  exceeded: string[];
  /** Presupuestos desde el 85% sin pasarse. */
  nearLimit: string[];
  /** Tarjetas con pago pendiente que vence de hoy a 3 días. */
  cardsDue: string[];
  /** Tarjetas con pago pendiente cuya fecha límite ya pasó. */
  cardsOverdue: string[];
  /** Tarjetas que usan el 30% del límite o más. */
  cardsHighUse: string[];
  /** Avisos sacados de los datos (precios, duplicados, gastos raros, saldo proyectado); null si no se pidieron. */
  insights: Insights | null;
}

/** Lo que pide atención hoy: fijos vencidos o por vencer y presupuestos del mes en aviso. */
export class GetAlerts {
  constructor(
    private readonly upcoming: GetUpcomingRecurring,
    private readonly budgets: GetBudgetStatuses,
    private readonly categories: ICategoryRepository,
    private readonly cards: GetCardStatuses,
    private readonly insights?: GetInsights,
  ) {}

  /** `list` une los nombres de un presupuesto con varias categorías en el idioma de la interfaz. */
  async execute(today: IsoDate, list?: (items: string[]) => string): Promise<Alerts> {
    const [items, statuses, categories, cards, insights] = await Promise.all([
      this.upcoming.execute(today, DUE_SOON_DAYS),
      this.budgets.execute(monthOf(today)),
      this.categories.list(),
      this.cards.execute(today),
      // Son una ayuda: si fallan, las alertas de siempre se muestran igual.
      this.insights?.execute(today).catch((e) => (console.error(e), null)) ?? null,
    ]);
    const types = new Map(categories.map((c) => [c.id, c.type]));
    const names = new Map(categories.map((c) => [c.id, c.name]));
    // Un ingreso fijo sin cobrar no es una alerta de pago.
    const payments = items.filter((i) => types.get(i.expense.categoryId) !== 'ingreso');
    const budgetNames = (level: string) =>
      statuses.filter((b) => budgetLevel(b.status) === level).map((b) => budgetName(b.budget, names, list));
    return {
      overdue: payments.filter((i) => daysBetween(today, i.instance.dueDate) < 0).map((i) => i.expense.name),
      dueSoon: payments.filter((i) => daysBetween(today, i.instance.dueDate) >= 0).map((i) => i.expense.name),
      exceeded: budgetNames('exceeded'),
      nearLimit: budgetNames('warning'),
      cardsDue: cards.filter((c) => c.pending > 0 && c.daysToDue >= 0 && c.daysToDue <= DUE_SOON_DAYS).map((c) => c.account.name),
      cardsOverdue: cards.filter((c) => c.pending > 0 && c.daysToDue < 0).map((c) => c.account.name),
      cardsHighUse: cards
        .filter((c) => (c.utilization ?? 0) >= CARD_UTILIZATION_WARNING)
        .map((c) => c.account.name),
      insights,
    };
  }
}
