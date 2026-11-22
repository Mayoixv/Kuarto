import { Cents } from './money';
import { addDays, dateInMonth, daysInMonth, IsoDate, monthOf } from './month';

export type AffordVerdict = 'si' | 'justo' | 'espera' | 'no';

/** Un pago con fecha que saldrá del dinero disponible: un fijo pendiente o el pago de una tarjeta. */
export interface Outflow {
  date: IsoDate;
  amount: Cents;
  /** Nombre del fijo o de la tarjeta, para decir qué pago deja corto. */
  label: string;
}

export interface Income {
  date: IsoDate;
  amount: Cents;
}

export interface CashFlowInput {
  /** Dinero con el que se cuenta hoy. */
  available: Cents;
  outflows: Outflow[];
  incomes: Income[];
  /** Gasto variable estimado por día; se resta cada día a partir de mañana. */
  dailyBurn: Cents;
  today: IsoDate;
}

export interface Affordability {
  verdict: AffordVerdict;
  /** Lo que quedaría a fin de mes comprando hoy. */
  left: Cents;
  /** `left` repartido entre los días que faltan del mes, hoy incluido. */
  perDay: Cents;
  days: number;
  /** Fijos y tarjetas que faltan por pagar hasta fin de mes. */
  pending: Cents;
  /** Solo en 'espera': primer día en que se puede comprar sin dejar ningún pago sin cubrir. */
  waitUntil?: IsoDate;
  /** El punto más bajo del dinero, día por día, comprando hoy; y qué día cae. */
  lowest: Cents;
  lowestDate: IsoDate;
  /** Primer día en que el dinero quedaría en negativo y el pago que lo causa (null si es el gasto diario). */
  bottleneck?: { date: IsoDate; label: string | null };
}

/** Días que se miran después del mes: alcanza para el alquiler o el sueldo del día 1 al 5. */
export const DAYS_INTO_NEXT_MONTH = 5;

interface Simulation {
  lowest: Cents;
  lowestDate: IsoDate;
  atMonthEnd: Cents;
  bottleneck?: { date: IsoDate; label: string | null };
}

/** Recorre día por día desde hoy hasta el horizonte restando la compra el día `purchaseDate` (null: sin compra). */
function simulate(amount: Cents, purchaseDate: IsoDate | null, input: CashFlowInput, horizon: IsoDate): Simulation {
  const { today } = input;
  const monthEnd = dateInMonth(monthOf(today), daysInMonth(monthOf(today)));
  // Lo vencido y sin pagar se cobra hoy; lo que cae después del horizonte no se mira.
  const dayOf = (date: IsoDate) => (date < today ? today : date);
  let balance = input.available;
  let lowest = balance;
  let lowestDate = today;
  let atMonthEnd = balance;
  let bottleneck: Simulation['bottleneck'];

  for (let date = today; date <= horizon; date = addDays(date, 1)) {
    if (date !== today) balance -= input.dailyBurn;
    for (const income of input.incomes) if (income.date === date) balance += income.amount;
    const due = input.outflows.filter((o) => dayOf(o.date) === date).sort((a, b) => b.amount - a.amount);
    for (const o of due) balance -= o.amount;
    if (date === purchaseDate) balance -= amount;
    if (balance < lowest) [lowest, lowestDate] = [balance, date];
    if (balance < 0 && !bottleneck) bottleneck = { date, label: due[0]?.label ?? null };
    if (date === monthEnd) atMonthEnd = balance;
  }
  return { lowest, lowestDate, atMonthEnd, bottleneck };
}

/**
 * "¿Me alcanza?": proyecta el dinero día por día hasta fin de mes (y los primeros días del siguiente) con los fijos
 * y las tarjetas en sus fechas, los cobros fijos y el ritmo de gasto diario. Si comprando hoy algún día queda en
 * negativo, busca el primer día en que sí se puede comprar sin dejar ningún pago sin cubrir.
 */
export function canAfford(amount: Cents, input: CashFlowInput): Affordability {
  const { today } = input;
  const month = monthOf(today);
  const monthEnd = dateInMonth(month, daysInMonth(month));
  const horizon = addDays(monthEnd, DAYS_INTO_NEXT_MONTH);
  const days = daysInMonth(month) - Number(today.slice(8, 10)) + 1;
  const pending = input.outflows.filter((o) => o.date <= monthEnd).reduce((s, o) => s + o.amount, 0);

  const without = simulate(amount, null, input, horizon);
  const buying = simulate(amount, today, input, horizon);
  const result: Affordability = {
    verdict: 'no',
    left: buying.atMonthEnd,
    perDay: Math.trunc(buying.atMonthEnd / days),
    days,
    pending,
    lowest: buying.lowest,
    lowestDate: buying.lowestDate,
    bottleneck: buying.bottleneck,
  };
  if (buying.lowest >= 0) return { ...result, verdict: buying.lowest * 2 < without.lowest ? 'justo' : 'si' };

  for (let date = addDays(today, 1); date <= horizon; date = addDays(date, 1)) {
    if (simulate(amount, date, input, horizon).lowest >= 0) return { ...result, verdict: 'espera', waitUntil: date };
  }
  return result;
}
