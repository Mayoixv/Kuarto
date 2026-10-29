/** Moneda en que se muestran los montos. Cambiarla no convierte nada: solo cambia el símbolo. */
export type Currency = 'DOP' | 'USD';

export function isCurrency(value: unknown): value is Currency {
  return value === 'DOP' || value === 'USD';
}

/** La otra moneda que admite la app (DOP ↔ USD). */
export function otherCurrency(value: Currency): Currency {
  return value === 'DOP' ? 'USD' : 'DOP';
}

/**
 * Equivalente en la otra moneda con una tasa en pesos por dólar. Es solo un dato para mostrar:
 * los montos guardados nunca se convierten.
 */
export function convertCents(cents: number, from: Currency, usdToDop: number): number {
  return Math.round(from === 'USD' ? cents * usdToDop : cents / usdToDop);
}
