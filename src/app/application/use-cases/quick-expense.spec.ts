import { CASH_ACCOUNT_ID } from '../../domain/account';
import { ValidationError } from '../errors';
import { InMemoryAccounts, InMemoryCategories, InMemorySettings, InMemoryTransactions, SequentialIds } from '../testing/in-memory';
import { AddTransaction } from './add-transaction';
import { AddQuickExpense, LAST_ACCOUNT_KEY, lastCategoryKey } from './quick-expense';

function setup() {
  const categories = new InMemoryCategories();
  const transactions = new InMemoryTransactions();
  const accounts = new InMemoryAccounts(transactions, categories);
  const settings = new InMemorySettings();
  categories.items.set('cat-gasolina', { id: 'cat-gasolina', name: 'Gasolina', type: 'variable' });
  categories.items.set('cat-otros-gastos', { id: 'cat-otros-gastos', name: 'Otros gastos', type: 'variable' });
  categories.items.set('cat-comida', { id: 'cat-comida', name: 'Comida', type: 'variable' });
  categories.items.set('cat-salario', { id: 'cat-salario', name: 'Salario', type: 'ingreso' });
  const add = new AddTransaction(transactions, categories, new SequentialIds(), accounts);
  const quick = new AddQuickExpense(categories, transactions, accounts, settings, add);
  return { quick, settings, accounts, transactions };
}

describe('registro rápido desde la notificación', () => {
  it('entiende "500 gasolina" y lo guarda como gasto de hoy en Efectivo', async () => {
    const { quick, transactions } = setup();
    const saved = await quick.execute('500 gasolina', '2026-10-29');
    expect(saved).toMatchObject({ date: '2026-10-29', amount: 50_000, categoryId: 'cat-gasolina', accountId: CASH_ACCOUNT_ID });
    expect(await transactions.listAll()).toHaveLength(1);
  });

  it('sin categoría en la frase usa la última de gasto (o Otros gastos), y la última cuenta usada', async () => {
    const { quick, settings, accounts } = setup();
    expect((await quick.execute('1200 regalo', '2026-10-29')).categoryId).toBe('cat-otros-gastos');

    await settings.set(lastCategoryKey('gasto'), 'cat-comida');
    accounts.items.set('acc-banco', { id: 'acc-banco', name: 'Banco', type: 'banco', initialBalance: 0, archived: false });
    await settings.set(LAST_ACCOUNT_KEY, 'acc-banco');
    expect(await quick.execute('800 cumpleaños', '2026-10-29')).toMatchObject({ categoryId: 'cat-comida', accountId: 'acc-banco' });
  });

  it('nunca lo guarda como ingreso y rechaza un texto sin monto', async () => {
    const { quick, transactions } = setup();
    expect((await quick.execute('500 salario', '2026-10-29')).categoryId).not.toBe('cat-salario');
    await expect(quick.execute('gasolina', '2026-10-29')).rejects.toThrow(ValidationError);
    expect(await transactions.listAll()).toHaveLength(1);
  });
});
