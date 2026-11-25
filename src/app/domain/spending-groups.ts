import { Cents } from './money';
import { foldText } from './rules';
import { expandSplits, Transaction } from './transaction';

export interface SpendingGroup {
  /** Etiqueta, o la nota tal como más veces se escribió. */
  name: string;
  total: Cents;
  count: number;
}

/** Cuántos grupos se devuelven como máximo. */
export const TOP_GROUPS = 8;

function top(groups: Map<string, { names: Map<string, number>; total: Cents; count: number }>): SpendingGroup[] {
  return [...groups.values()]
    .map((g) => ({ name: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0], total: g.total, count: g.count }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, TOP_GROUPS);
}

function group(list: Transaction[], isExpense: (categoryId: string) => boolean, keys: (t: Transaction) => string[]): SpendingGroup[] {
  const groups = new Map<string, { names: Map<string, number>; total: Cents; count: number }>();
  for (const t of expandSplits(list)) {
    if (!isExpense(t.categoryId)) continue;
    for (const raw of keys(t)) {
      const name = raw.trim();
      const key = foldText(name);
      if (!key) continue;
      const g = groups.get(key) ?? { names: new Map(), total: 0, count: 0 };
      g.names.set(name, (g.names.get(name) ?? 0) + 1);
      g.total += t.amount;
      g.count++;
      groups.set(key, g);
    }
  }
  return top(groups);
}

/** Gasto por etiqueta: un movimiento con dos etiquetas cuenta en las dos. */
export function spendingByTag(list: Transaction[], isExpense: (categoryId: string) => boolean): SpendingGroup[] {
  return group(list, isExpense, (t) => t.tags ?? []);
}

/**
 * Gasto por comercio: la nota hace de comercio ("Supermercado Nacional", "Uber"), sin distinguir mayúsculas ni
 * acentos. Las notas vacías no cuentan.
 */
export function spendingByNote(list: Transaction[], isExpense: (categoryId: string) => boolean): SpendingGroup[] {
  return group(list, isExpense, (t) => [t.note]);
}
