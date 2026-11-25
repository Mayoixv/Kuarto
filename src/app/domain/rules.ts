/**
 * Regla automática: si la nota (o la frase rápida, o la descripción de un archivo importado) contiene `match`, el
 * movimiento va a esa categoría y, si la regla lo dice, a esa cuenta y con esa etiqueta. Como las reglas de
 * Monarch, Actual o Copilot, pero solo con "contiene", que es lo que se entiende sin explicación.
 */
export interface CategoryRule {
  id: string;
  /** Texto a buscar; se compara sin mayúsculas ni acentos. */
  match: string;
  categoryId: string;
  accountId?: string | null;
  tag?: string | null;
}

export const RULE_MIN_LENGTH = 2;
export const RULE_MAX_LENGTH = 60;

export const foldText = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/**
 * La regla que aplica a un texto. Si varias coinciden gana la más específica (el texto más largo): "uber eats" le
 * gana a "uber". Solo cuentan reglas cuya categoría siga disponible.
 */
export function matchRule<R extends CategoryRule>(text: string, rules: R[], usable?: (categoryId: string) => boolean): R | undefined {
  const haystack = foldText(text);
  if (!haystack) return undefined;
  return rules
    .filter((r) => (!usable || usable(r.categoryId)) && foldText(r.match).length >= RULE_MIN_LENGTH && haystack.includes(foldText(r.match)))
    .sort((a, b) => foldText(b.match).length - foldText(a.match).length)[0];
}
