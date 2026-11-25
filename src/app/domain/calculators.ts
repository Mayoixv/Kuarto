import { Cents } from './money';

/** Límite de años en las calculadoras: más allá los resultados dejan de ser útiles (y los ciclos, cortos). */
export const MAX_YEARS = 100;

export interface CompoundResult {
  /** Valor al final. */
  total: Cents;
  /** Lo que pusiste: inicial + aportes. */
  contributed: Cents;
  /** Lo que generó el interés. */
  interest: Cents;
  /** Valor al final de cada año, para la gráfica. */
  byYear: Cents[];
}

/**
 * Interés compuesto con aporte al final de cada mes y capitalización mensual (tasa anual / 12), la forma en que lo
 * calculan los bancos para cuentas de ahorro y certificados.
 */
export function compoundInterest(initial: Cents, monthly: Cents, annualRatePercent: number, years: number): CompoundResult {
  const months = Math.round(Math.min(Math.max(years, 0), MAX_YEARS) * 12);
  const r = annualRatePercent / 100 / 12;
  let balance = initial;
  const byYear: Cents[] = [];
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + r) + monthly;
    if (m % 12 === 0) byYear.push(Math.round(balance));
  }
  const total = Math.round(balance);
  const contributed = initial + monthly * months;
  return { total, contributed, interest: total - contributed, byYear };
}

/** Lo que costará en `years` años algo que hoy cuesta `amount`, con inflación anual constante. */
export function futureCost(amount: Cents, inflationPercent: number, years: number): Cents {
  return Math.round(amount * (1 + inflationPercent / 100) ** Math.min(Math.max(years, 0), MAX_YEARS));
}

/** Lo que podrán comprar en `years` años `amount` pesos de hoy (poder adquisitivo). */
export function purchasingPower(amount: Cents, inflationPercent: number, years: number): Cents {
  return Math.round(amount / (1 + inflationPercent / 100) ** Math.min(Math.max(years, 0), MAX_YEARS));
}

export interface FireResult {
  /** Lo que hace falta juntar para vivir de los rendimientos: gasto anual / tasa de retiro. */
  target: Cents;
  /** Años hasta llegar al ritmo dado; 0 si ya llegaste, null si con ese ritmo nunca se llega en MAX_YEARS. */
  years: number | null;
}

/**
 * Independencia financiera (FIRE): con la "regla del 4%" (estudio Trinity) se necesita 25 veces el gasto anual.
 * `years` simula mes a mes con la rentabilidad anual esperada (ya descontada la inflación, si se quiere en pesos de hoy).
 */
export function fire(annualExpenses: Cents, withdrawalRatePercent: number, saved: Cents, monthly: Cents, annualReturnPercent: number): FireResult {
  if (withdrawalRatePercent <= 0) return { target: 0, years: null };
  const target = Math.round(annualExpenses / (withdrawalRatePercent / 100));
  if (saved >= target) return { target, years: 0 };
  const r = annualReturnPercent / 100 / 12;
  let balance = saved;
  for (let m = 1; m <= MAX_YEARS * 12; m++) {
    balance = balance * (1 + r) + monthly;
    if (balance >= target) return { target, years: Math.round((m / 12) * 10) / 10 };
  }
  return { target, years: null };
}

/** Meses que se necesitarían ahorrando `monthly` para llegar a `target` desde `saved` (sin intereses); null si nunca. */
export function monthsToReach(target: Cents, saved: Cents, monthly: Cents): number | null {
  if (saved >= target) return 0;
  return monthly > 0 ? Math.ceil((target - saved) / monthly) : null;
}
