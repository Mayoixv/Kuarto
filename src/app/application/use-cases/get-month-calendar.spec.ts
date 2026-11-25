import { InMemoryAccounts, InMemoryCategories, InMemoryDebts, InMemoryRecurring, InMemorySettings, InMemoryTransactions } from '../testing/in-memory';
import { GetCardStatuses } from './accounts';
import { GetDebtsOverview } from './debts';
import { GetDebtInstallments } from './get-debt-installments';
import { GetMonthCalendar } from './get-month-calendar';
import { GetMonthRecurringExpenses } from './get-month-recurring-expenses';

describe('calendario del mes', () => {
  it('pone fijos, cobros, tarjetas, cuotas y lo movido en su día, con su estado', async () => {
    const categories = new InMemoryCategories();
    categories.items.set('luz', { id: 'luz', name: 'Luz', type: 'fijo' });
    categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
    categories.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
    const recurring = new InMemoryRecurring();
    const base = { active: true, startMonth: '2026-11' };
    await recurring.save({ ...base, id: 'f1', name: 'Luz', amount: 250000, categoryId: 'luz', dueDay: 5 });
    await recurring.save({ ...base, id: 'f2', name: 'Sueldo', amount: 3000000, categoryId: 'sal', dueDay: 30 });
    const transactions = new InMemoryTransactions();
    await transactions.save({ id: 't1', date: '2026-11-10', amount: 45000, categoryId: 'com', note: '' });
    await transactions.save({ id: 't2', date: '2026-11-10', amount: 5000, categoryId: 'sal', note: '' });
    const accounts = new InMemoryAccounts(transactions, categories);
    // Visa corta el 1 y vence el 20; debía 10,000 al cortar.
    await accounts.save({ id: 'visa', name: 'Visa', type: 'tarjeta', initialBalance: -1_000_000, creditLimit: 5_000_000, cutDay: 1, dueDay: 20, archived: false });
    const debts = new InMemoryDebts();
    await debts.save({ id: 'd1', name: 'Préstamo', direction: 'debo', principal: 1_200_000, annualRate: 0, termMonths: 12, startDate: '2026-10-15' });

    const calendar = new GetMonthCalendar(
      new GetMonthRecurringExpenses(recurring),
      new GetCardStatuses(accounts, new InMemorySettings()),
      new GetDebtInstallments(new GetDebtsOverview(debts, recurring)),
      transactions,
      categories,
    );
    const days = await calendar.execute('2026-11', '2026-11-12');
    expect(days).toHaveLength(30);
    expect(days[4].events).toEqual([{ kind: 'pago', label: 'Luz', amount: 250000, status: 'vencido' }]);
    expect(days[29].events[0]).toMatchObject({ kind: 'cobro', status: 'pendiente' });
    expect(days[19].events[0]).toMatchObject({ kind: 'tarjeta', label: 'Visa', amount: 1_000_000, status: 'pendiente' });
    expect(days[14].events[0]).toMatchObject({ kind: 'cuota', label: 'Préstamo', amount: 100_000, status: 'pendiente' });
    expect(days[9]).toMatchObject({ spent: 45000, earned: 5000, events: [] });
  });
});
