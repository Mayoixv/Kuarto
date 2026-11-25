import { possibleDuplicates, priceChange, unusualSpending } from './insights';
import { RecurringExpenseInstance } from './recurring-expense';
import { Transaction } from './transaction';

const paid = (month: string, amount: number, status: RecurringExpenseInstance['status'] = 'pagado'): RecurringExpenseInstance => ({
  recurringExpenseId: 'net',
  month,
  dueDate: `${month}-05`,
  amount,
  status,
});

describe('cambio de precio de un fijo', () => {
  it('compara los dos últimos pagos, sin contar pendientes ni omitidos', () => {
    expect(priceChange([paid('2026-09', 59900), paid('2026-10', 64900), paid('2026-11', 70000, 'pendiente')])).toEqual({
      from: 59900,
      to: 64900,
    });
    expect(priceChange([paid('2026-10', 64900), paid('2026-09', 59900)])).toEqual({ from: 59900, to: 64900 });
  });

  it('no avisa por cambios menores del 5%, con un solo pago o con un pago anterior en cero', () => {
    expect(priceChange([paid('2026-09', 100000), paid('2026-10', 104000)])).toBeNull();
    expect(priceChange([paid('2026-10', 100000)])).toBeNull();
    expect(priceChange([paid('2026-09', 0), paid('2026-10', 100)])).toBeNull();
    expect(priceChange([paid('2026-09', 100000), paid('2026-10', 95000)])).toEqual({ from: 100000, to: 95000 });
  });
});

describe('movimientos repetidos', () => {
  const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
    id,
    date: '2026-11-03',
    amount: 45000,
    categoryId: 'com',
    note: 'Comedor',
    ...extra,
  });

  it('agrupa los que coinciden en fecha, monto, categoría, cuenta y nota (sin importar mayúsculas)', () => {
    const groups = possibleDuplicates([tx('a'), tx('b', { note: ' comedor ' }), tx('c', { amount: 45001 }), tx('d', { accountId: 'x' })]);
    expect(groups.map((g) => g.map((t) => t.id))).toEqual([['a', 'b']]);
  });

  it('sin movimientos o sin repetidos, nada', () => {
    expect(possibleDuplicates([])).toEqual([]);
    expect(possibleDuplicates([tx('a'), tx('b', { note: 'Comedor 2' })])).toEqual([]);
  });
});

describe('gasto inusual', () => {
  const m = (entries: [string, number][]) => new Map(entries);

  it('avisa cuando una categoría va 1.5 veces por encima de su promedio y la diferencia pesa', () => {
    const history = [m([['com', 1_000_000], ['luz', 300_000]]), m([['com', 1_200_000], ['luz', 300_000]])];
    const out = unusualSpending(m([['com', 1_700_000], ['luz', 310_000]]), history);
    expect(out).toEqual([{ categoryId: 'com', current: 1_700_000, average: 1_100_000 }]);
  });

  it('no avisa sin historial suficiente ni por diferencias pequeñas frente al gasto total', () => {
    expect(unusualSpending(m([['com', 9_000_000]]), [m([['com', 1_000]])])).toEqual([]);
    // 2 000 contra un promedio de 1 000 es el doble, pero es menos del 5% del gasto mensual (1 001 000).
    const history = [m([['cafe', 1_000], ['casa', 1_000_000]]), m([['cafe', 1_000], ['casa', 1_000_000]])];
    expect(unusualSpending(m([['cafe', 2_000]]), history)).toEqual([]);
    // Una categoría nueva (sin meses anteriores) tampoco: no hay costumbre con qué comparar.
    expect(unusualSpending(m([['viaje', 5_000_000]]), history)).toEqual([]);
  });
});
