import { Cents } from './money';

export interface AmountFilter {
  /** Límites en centavos, inclusive; null si no se escribieron. */
  min: Cents | null;
  max: Cents | null;
  /** Lo que queda de la búsqueda para buscar como texto. */
  text: string;
}

const NUMBER = String.raw`\d+(?:[.,]\d{1,2})?`;
const RANGE = new RegExp(String.raw`(?:^|\s)(${NUMBER})-(${NUMBER})(?=\s|$)`, 'g');
const BOUND = new RegExp(String.raw`(?:^|\s)([<>])=?\s?(${NUMBER})(?=\s|$)`, 'g');

const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

/**
 * Entiende montos dentro de la búsqueda de Movimientos: ">500" (500 o más), "<1000" (hasta 1000) y "500-1000".
 * Lo demás se queda como texto: "uber >300" busca "uber" en gastos de 300 o más.
 */
export function parseAmountFilter(query: string): AmountFilter {
  let min: Cents | null = null;
  let max: Cents | null = null;
  let text = query.replace(RANGE, (_, a: string, b: string) => {
    const [lo, hi] = [toCents(a), toCents(b)].sort((x, y) => x - y);
    min = lo;
    max = hi;
    return ' ';
  });
  text = text.replace(BOUND, (_, op: string, n: string) => {
    if (op === '>') min = toCents(n);
    else max = toCents(n);
    return ' ';
  });
  return { min, max, text: text.replace(/\s+/g, ' ').trim() };
}

export function inAmountRange(amount: Cents, filter: Pick<AmountFilter, 'min' | 'max'>): boolean {
  return (filter.min === null || amount >= filter.min) && (filter.max === null || amount <= filter.max);
}
