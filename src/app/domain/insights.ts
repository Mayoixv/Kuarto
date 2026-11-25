import { Cents } from './money';
import { RecurringExpenseInstance } from './recurring-expense';
import { Transaction } from './transaction';

/** Desde este cambio (5%) el monto pagado de un fijo cuenta como subida o bajada de precio, como Rocket Money. */
export const PRICE_CHANGE_PERCENT = 5;

export interface PriceChange {
  from: Cents;
  to: Cents;
}

/** Cambio de precio entre los dos últimos pagos de un fijo; null si no hay dos pagos o el cambio es pequeño. */
export function priceChange(instances: RecurringExpenseInstance[]): PriceChange | null {
  const paid = instances.filter((i) => i.status === 'pagado').sort((a, b) => a.month.localeCompare(b.month));
  if (paid.length < 2) return null;
  const [prev, last] = paid.slice(-2);
  if (prev.amount <= 0) return null;
  const percent = (Math.abs(last.amount - prev.amount) / prev.amount) * 100;
  return percent >= PRICE_CHANGE_PERCENT ? { from: prev.amount, to: last.amount } : null;
}

/**
 * Movimientos que parecen registrados dos veces: misma fecha, monto, categoría, cuenta y nota.
 * Cambiar la nota de uno basta para que deje de salir (dos cafés iguales el mismo día son posibles).
 */
export function possibleDuplicates(list: Transaction[]): Transaction[][] {
  const groups = new Map<string, Transaction[]>();
  for (const t of list) {
    const key = [t.date, t.amount, t.categoryId, t.accountId ?? '', t.note.trim().toLocaleLowerCase()].join('|');
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export interface UnusualSpending {
  categoryId: string;
  current: Cents;
  /** Promedio de los meses anteriores con gasto en la categoría. */
  average: Cents;
}

/** Cuántas veces el promedio debe superar el gasto del mes para avisar. */
export const UNUSUAL_FACTOR = 1.5;
/** Meses anteriores con gasto que hacen falta para tener un promedio confiable. */
export const UNUSUAL_MIN_MONTHS = 2;
/** La diferencia debe ser al menos esta parte del gasto mensual promedio total, para no avisar por centavos. */
export const UNUSUAL_MIN_SHARE = 0.05;

/**
 * Categorías en que este mes ya se gastó bastante más que de costumbre.
 * `current` y cada mes de `history` son el gasto por categoría (en la misma moneda).
 */
export function unusualSpending(current: Map<string, Cents>, history: Map<string, Cents>[]): UnusualSpending[] {
  const months = history.filter((m) => m.size > 0);
  if (months.length < UNUSUAL_MIN_MONTHS) return [];
  const totalAverage = months.reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0) / months.length;
  const out: UnusualSpending[] = [];
  for (const [categoryId, spent] of current) {
    const past = months.map((m) => m.get(categoryId) ?? 0).filter((v) => v > 0);
    if (past.length < UNUSUAL_MIN_MONTHS) continue;
    const average = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
    if (spent >= average * UNUSUAL_FACTOR && spent - average >= totalAverage * UNUSUAL_MIN_SHARE) {
      out.push({ categoryId, current: spent, average });
    }
  }
  return out.sort((a, b) => b.current - b.average - (a.current - a.average));
}
