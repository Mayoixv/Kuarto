import { Cents } from './money';

export type HealthLevel = 'bajo' | 'medio' | 'bueno';

export interface HealthMetric {
  value: number;
  level: HealthLevel;
}

export interface FinancialHealth {
  /** Meses de gasto que cubre el dinero disponible (fondo de emergencia). Guía común: de 3 a 6. */
  monthsCovered: HealthMetric | null;
  /** Porcentaje del ingreso que se ahorra en promedio. La regla 50/30/20 sugiere al menos 20%. */
  savingsRate: HealthMetric | null;
  /** Cuotas de deudas al mes frente al ingreso. Los prestamistas suelen pedir 36% o menos. */
  debtToIncome: HealthMetric | null;
  /** Promedios de los meses usados. */
  income: Cents;
  expenses: Cents;
  months: number;
}

export interface HealthInput {
  /** Dinero en cuentas, sin tarjetas. */
  available: Cents;
  /** Meses completos recientes; los que no tienen ni ingresos ni gastos no cuentan. */
  history: { income: Cents; expenses: Cents; saved: Cents }[];
  /** Cuotas de deudas propias de un mes. */
  monthlyDebt: Cents;
}

const level = (value: number, good: number, ok: number, higherIsBetter = true): HealthLevel =>
  higherIsBetter ? (value >= good ? 'bueno' : value >= ok ? 'medio' : 'bajo') : value <= good ? 'bueno' : value <= ok ? 'medio' : 'bajo';

export function financialHealth(input: HealthInput): FinancialHealth {
  const months = input.history.filter((m) => m.income > 0 || m.expenses > 0);
  const avg = (pick: (m: HealthInput['history'][number]) => number) =>
    months.length ? Math.round(months.reduce((s, m) => s + pick(m), 0) / months.length) : 0;
  const income = avg((m) => m.income);
  const expenses = avg((m) => m.expenses);
  const saved = avg((m) => m.saved);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const covered = expenses > 0 ? round1(Math.max(0, input.available) / expenses) : null;
  const rate = income > 0 ? round1((saved / income) * 100) : null;
  const dti = income > 0 ? round1((input.monthlyDebt / income) * 100) : null;
  return {
    monthsCovered: covered === null ? null : { value: covered, level: level(covered, 3, 1) },
    savingsRate: rate === null ? null : { value: rate, level: level(rate, 20, 10) },
    debtToIncome: dti === null ? null : { value: dti, level: level(dti, 20, 36, false) },
    income,
    expenses,
    months: months.length,
  };
}
