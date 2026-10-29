import { Currency } from '../domain/currency';
import { Cents } from '../domain/money';
import { addMonths, dateInMonth, daysBetween, IsoDate, MonthKey, monthOf } from '../domain/month';
import { t, tn, locale } from './i18n';

// El símbolo va fijo: el WebView de Android trae datos de idioma recortados y con style 'currency'
// escribe "DOP 12.50" en vez de "RD$12.50".
const SYMBOLS: Record<Currency, string> = { DOP: 'RD$', USD: 'US$' };
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let currency: Currency = 'DOP';

/** Se llama al arrancar y al cambiar la moneda en Ajustes. */
export function setDisplayCurrency(value: Currency): void {
  currency = value;
}

export function displayCurrency(): Currency {
  return currency;
}

/** Recibe centavos: formatMoney(1250) muestra RD$12.50. */
export function formatMoney(cents: Cents): string {
  return formatMoneyIn(cents, currency);
}

/** Como formatMoney, pero en una moneda dada (el equivalente informativo en la otra moneda). */
export function formatMoneyIn(cents: Cents, target: Currency): string {
  const text = `${SYMBOLS[target]}${number.format(Math.abs(cents) / 100)}`;
  // El signo menos tipográfico (−), el mismo de las filas de gasto; el PDF lo cambia por '-'.
  return cents < 0 ? `−${text}` : text;
}

/** Convierte lo escrito en un campo de monto a centavos; null si no es un monto válido mayor que cero. */
export function parseAmount(text: string): Cents | null {
  const value = Number(text.trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

/** Como parseAmount pero para saldos: vacío es 0 y se admite negativo (un sobregiro). null si no es un número. */
export function parseBalance(text: string): Cents | null {
  if (!text.trim()) return 0;
  const value = Number(text.trim());
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Centavos al texto que se precarga en un campo al editar: 125050 pasa a "1250.5". */
export function amountToInput(cents: Cents): string {
  return String(cents / 100);
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`;
}

export function currentMonth(now = new Date()): MonthKey {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function todayIso(now = new Date()): string {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Fecha propuesta para un registro nuevo: hoy si se está viendo el mes actual; si no, el mismo día dentro del mes visto. */
export function defaultDateFor(month: MonthKey, today: IsoDate = todayIso()): IsoDate {
  return monthOf(today) === month ? today : dateInMonth(month, Number(today.slice(8, 10)));
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  return addMonths(month, delta);
}

/** "Septiembre de 2026"; con `capital` en false, como va en medio de una frase ("tu septiembre de 2026"). */
export function monthLabel(month: MonthKey, capital = true): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(
    new Date(y, m - 1, 1),
  );
  return capital ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, d),
  );
}

export interface DueLabel {
  text: string;
  /** Vencido o a 3 días o menos: se resalta en ámbar. */
  urgent: boolean;
  /** Ya pasó la fecha: un pago vencido se marca en rojo (un cobro atrasado sigue en ámbar). */
  overdue: boolean;
}

/** Texto de vencimiento de un gasto fijo pendiente, relativo a hoy. */
/** Con `income`, habla de cobrar en vez de vencer (sueldo y otros ingresos fijos). */
export function dueLabel(dueDate: IsoDate, today: IsoDate, income = false): DueLabel {
  const kind = income ? 'Income' : 'Expense';
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return { text: tn(`due.past${kind}`, -diff), urgent: true, overdue: true };
  if (diff === 0) return { text: t(`due.today${kind}`), urgent: true, overdue: false };
  if (diff === 1) return { text: t(`due.tomorrow${kind}`), urgent: true, overdue: false };
  if (diff <= 7) return { text: t(`due.inDays${kind}`, { count: diff }), urgent: diff <= 3, overdue: false };
  return { text: t(`due.on${kind}`, { date: formatDay(dueDate) }), urgent: false, overdue: false };
}
