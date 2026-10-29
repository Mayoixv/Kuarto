import { isBigExpense, pickIndex } from '../../domain/personality';
import { InMemoryCategories, InMemorySavings, InMemorySettings, InMemoryTransactions } from '../testing/in-memory';
import { GetMonthOverview } from './get-month-overview';
import { CheckBigExpense, PersonalitySettings } from './personality';

describe('personalidad', () => {
  it('está desactivada por defecto y el aviso de la opción nueva sale una sola vez', async () => {
    const personality = new PersonalitySettings(new InMemorySettings());
    expect(await personality.get()).toBe('off');
    await personality.set('funny');
    expect(await personality.get()).toBe('funny');
    expect(await personality.announceOnce()).toBe(true);
    expect(await personality.announceOnce()).toBe(false);
  });

  it('un gasto es grande si pasa el 10% de los ingresos del mes, o un monto fijo si no hubo ingresos', () => {
    expect(isBigExpense(300_001, 3_000_000, 'DOP')).toBe(true);
    expect(isBigExpense(300_000, 3_000_000, 'DOP')).toBe(false);
    expect(isBigExpense(500_000, 0, 'DOP')).toBe(true);
    expect(isBigExpense(499_999, 0, 'DOP')).toBe(false);
    expect(isBigExpense(10_000, 0, 'USD')).toBe(true);
  });

  it('elige un chiste al azar sin repetir el último', () => {
    for (const random of [0, 0.3, 0.6, 0.99]) expect(pickIndex(3, 1, random)).not.toBe(1);
    expect(pickIndex(1, 0, 0.5)).toBe(0);
    expect(pickIndex(4, null, 0.99)).toBe(3);
  });

  it('solo cuenta gastos (no ingresos) y compara con los ingresos de su mes', async () => {
    const categories = new InMemoryCategories();
    const transactions = new InMemoryTransactions();
    categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
    categories.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
    await transactions.save({ id: 't1', date: '2026-10-01', amount: 1_000_000, categoryId: 'sal', note: '' });
    const check = new CheckBigExpense(categories, new GetMonthOverview(transactions, categories, new InMemorySavings()));
    expect(await check.execute({ date: '2026-10-05', amount: 150_000, categoryId: 'com' }, 'DOP')).toBe(true);
    expect(await check.execute({ date: '2026-10-05', amount: 90_000, categoryId: 'com' }, 'DOP')).toBe(false);
    expect(await check.execute({ date: '2026-10-05', amount: 9_000_000, categoryId: 'sal' }, 'DOP')).toBe(false);
    // Noviembre no tiene ingresos: se compara con el monto fijo.
    expect(await check.execute({ date: '2026-11-05', amount: 150_000, categoryId: 'com' }, 'DOP')).toBe(false);
  });
});
