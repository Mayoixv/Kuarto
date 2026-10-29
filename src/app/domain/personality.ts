import { Currency } from './currency';

/** Tono de los avisos de la app. "funny" agrega un chiste corto al registrar un gasto grande. */
export type Personality = 'off' | 'funny';

export function isPersonality(value: unknown): value is Personality {
  return value === 'off' || value === 'funny';
}

/** Un gasto es grande si pasa esta parte de los ingresos del mes (0.10 = 10%). */
export const BIG_EXPENSE_SHARE = 0.1;
/** Sin ingresos en el mes, se compara con un monto fijo, en centavos de la moneda que se muestra. */
export const BIG_EXPENSE_FALLBACK: Record<Currency, number> = { DOP: 500_000, USD: 10_000 };

export function isBigExpense(amount: number, monthIncome: number, currency: Currency): boolean {
  return monthIncome > 0 ? amount > monthIncome * BIG_EXPENSE_SHARE : amount >= BIG_EXPENSE_FALLBACK[currency];
}

/** Índice al azar entre `count` opciones, distinto de `last` cuando hay más de una. `random` en [0, 1). */
export function pickIndex(count: number, last: number | null, random: number): number {
  if (count <= 1) return 0;
  const options = Array.from({ length: count }, (_, i) => i).filter((i) => i !== last);
  return options[Math.floor(random * options.length)];
}
