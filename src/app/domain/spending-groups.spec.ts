import { spendingByNote, spendingByTag, TOP_GROUPS } from './spending-groups';
import { Transaction } from './transaction';

const tx = (id: string, amount: number, note: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  date: '2026-11-01',
  amount,
  categoryId: 'com',
  note,
  ...extra,
});
const isExpense = (id: string) => id !== 'sal';

describe('gasto por comercio y por etiqueta', () => {
  it('agrupa notas sin mayúsculas ni acentos y usa la forma más escrita', () => {
    const out = spendingByNote(
      [tx('a', 100, 'Café Santo'), tx('b', 200, 'cafe santo'), tx('c', 50, 'Café Santo'), tx('d', 999, 'Sueldo', { categoryId: 'sal' }), tx('e', 10, '  ')],
      isExpense,
    );
    expect(out).toEqual([{ name: 'Café Santo', total: 350, count: 3 }]);
  });

  it('cuenta cada etiqueta y respeta las divisiones', () => {
    const out = spendingByTag(
      [
        tx('a', 100, '', { tags: ['viaje', 'playa'] }),
        tx('b', 300, '', { tags: ['Viaje'], splits: [{ categoryId: 'com', amount: 200 }, { categoryId: 'sal', amount: 100 }] }),
      ],
      isExpense,
    );
    expect(out).toEqual([
      { name: 'viaje', total: 300, count: 2 },
      { name: 'playa', total: 100, count: 1 },
    ]);
  });

  it('devuelve como mucho los más grandes', () => {
    const many = Array.from({ length: TOP_GROUPS + 3 }, (_, i) => tx(String(i), i + 1, 'n' + i));
    const out = spendingByNote(many, isExpense);
    expect(out).toHaveLength(TOP_GROUPS);
    expect(out[0].total).toBe(TOP_GROUPS + 3);
  });
});
