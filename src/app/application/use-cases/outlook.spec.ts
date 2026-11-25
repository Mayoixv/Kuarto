import { buildContainer } from '../../app.container';
import {
  InMemoryAccounts,
  InMemoryBudgets,
  InMemoryCategories,
  InMemoryCategoryRules,
  InMemoryDebts,
  InMemoryRecurring,
  InMemorySavings,
  InMemorySettings,
  InMemoryTransactions,
  SequentialIds,
} from '../testing/in-memory';
import { CASH_ACCOUNT_ID } from '../../domain/account';

async function setup(rent: number) {
  const categories = new InMemoryCategories();
  categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
  categories.items.set('alq', { id: 'alq', name: 'Alquiler', type: 'fijo' });
  const transactions = new InMemoryTransactions();
  const savings = new InMemorySavings();
  const accounts = new InMemoryAccounts(transactions, categories, savings);
  const recurring = new InMemoryRecurring();
  const container = buildContainer(
    {
      categories,
      transactions,
      recurring,
      savings,
      budgets: new InMemoryBudgets(),
      settings: new InMemorySettings(),
      backup: { dump: async () => ({ schemaVersion: 0, tables: {} }), restore: async () => undefined, wipe: async () => undefined },
      debts: new InMemoryDebts(),
      accounts,
      rules: new InMemoryCategoryRules(),
      secrets: new InMemorySettings(),
    },
    new SequentialIds(),
    { latest: () => Promise.reject(new Error('sin red')) },
  );
  await accounts.save({ id: CASH_ACCOUNT_ID, name: 'Efectivo', type: 'efectivo', initialBalance: 0, archived: false });
  await container.addTransaction.execute({ date: '2026-11-01', amount: 2_000_000, categoryId: 'sal' });
  await recurring.save({ id: 'f', name: 'Alquiler', amount: rent, categoryId: 'alq', dueDay: 20, active: true, startMonth: '2026-11' });
  return container;
}

describe('lo libre por día y el saldo proyectado', () => {
  it('reparte lo que queda después de lo pendiente entre los días que faltan', async () => {
    const c = await setup(1_000_000);
    const o = await c.canAfford.outlook('2026-11-10');
    // (20,000 − 10,000) entre los 21 días del 10 al 30.
    expect(o).toEqual({ perDay: 47_619, days: 21, pending: 1_000_000, shortfall: null });
  });

  it('avisa el día y el pago que dejaría las cuentas en negativo', async () => {
    const c = await setup(2_500_000);
    expect(await c.canAfford.outlook('2026-11-10')).toMatchObject({ perDay: -23_809, shortfall: { date: '2026-11-20', label: 'Alquiler' } });
    const insights = await c.getInsights.execute('2026-11-10');
    expect(insights.shortfall).toEqual({ date: '2026-11-20', label: 'Alquiler' });
    expect(insights).toMatchObject({ priceChanges: [], duplicates: 0, unusual: [] });
  });
});
