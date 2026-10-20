import { Cents } from './money';
import { addMonths, dateInMonth, IsoDate, monthOf } from './month';

export type AccountType = 'efectivo' | 'banco' | 'ahorro' | 'tarjeta' | 'inversion';

/** Cuenta que crea la migración; los movimientos de antes de existir las cuentas quedan en ella. */
export const CASH_ACCOUNT_ID = 'acc-efectivo';

/**
 * Cuenta interna, oculta en todas las listas: un ajuste de saldo es una transferencia entre ella y la cuenta ajustada.
 * Así sube o baja el saldo sin contar como ingreso ni gasto, igual que el pago de una tarjeta.
 */
export const ADJUST_ACCOUNT_ID = 'acc-ajuste';

/** Si la transferencia es un ajuste de saldo: la cuenta ajustada y la diferencia con signo. */
export function adjustmentOf(t: Transfer): { accountId: string; amount: number } | null {
  if (t.toAccountId === ADJUST_ACCOUNT_ID) return { accountId: t.fromAccountId, amount: -t.amount };
  if (t.fromAccountId === ADJUST_ACCOUNT_ID) return { accountId: t.toAccountId, amount: t.amount };
  return null;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /**
   * Saldo antes del primer movimiento registrado. En una tarjeta, lo que ya se debía (negativo).
   * "Ajustar saldo" cambia este valor para que el saldo calculado cuadre con el real.
   */
  initialBalance: Cents;
  /** Solo tarjetas: límite de crédito. */
  creditLimit?: Cents | null;
  /** Solo tarjetas: día del mes en que corta el estado de cuenta. */
  cutDay?: number | null;
  /** Solo tarjetas: día del mes en que vence el pago. */
  dueDay?: number | null;
  /** Archivada: no aparece para elegir en movimientos nuevos, pero conserva su historial. */
  archived: boolean;
  /** Últimos 4 dígitos de la tarjeta de crédito, para reconocerla. */
  cardLast4?: string | null;
}

/** Dinero que pasa de una cuenta a otra: no es ingreso ni gasto. */
export interface Transfer {
  id: string;
  date: IsoDate;
  amount: Cents;
  fromAccountId: string;
  toAccountId: string;
  note: string;
}

export const isCard = (a: Pick<Account, 'type'>) => a.type === 'tarjeta';

/** Desde este porcentaje del límite usado se avisa (por encima, afecta el historial de crédito). */
export const CARD_UTILIZATION_WARNING = 30;

/** Último corte en o antes de `today` (si el día no existe en el mes, el último día del mes). */
export function lastCutDate(cutDay: number, today: IsoDate): IsoDate {
  const month = monthOf(today);
  const thisMonth = dateInMonth(month, cutDay);
  return thisMonth <= today ? thisMonth : dateInMonth(addMonths(month, -1), cutDay);
}

/** Fecha límite de pago del estado que cortó en `cut`: el primer día de pago después del corte. */
export function dueDateAfter(cut: IsoDate, dueDay: number): IsoDate {
  const month = monthOf(cut);
  const sameMonth = dateInMonth(month, dueDay);
  return sameMonth > cut ? sameMonth : dateInMonth(addMonths(month, 1), dueDay);
}
