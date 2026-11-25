import { CASH_ACCOUNT_ID } from '../../domain/account';
import { summarizeMonth } from '../../domain/monthly-summary';
import { InMemoryAccounts, InMemoryCategories, InMemorySettings, InMemoryTransactions, SequentialIds } from '../testing/in-memory';
import { GetAccountsOverview, SaveAccount, SaveTransfer } from './accounts';
import { CurrencySettings } from './currency-settings';
import { GetExchangeRate } from './exchange-rate';
import { LoadMoneyConverter, MainCurrencyTransactions } from './money-converter';
import { GetMonthOverview } from './get-month-overview';
import { InMemorySavings } from '../testing/in-memory';

async function setup(rate: number | null = 60) {
  const settings = new InMemorySettings();
  const categories = new InMemoryCategories();
  categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
  categories.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
  const transactions = new InMemoryTransactions();
  const accounts = new InMemoryAccounts(transactions, categories);
  await accounts.save({ id: CASH_ACCOUNT_ID, name: 'Efectivo', type: 'efectivo', initialBalance: 0, archived: false });
  const rates = new GetExchangeRate(settings, { latest: async () => ({ usdToDop: rate ?? 0, date: '2026-11-24' }) });
  if (rate) await rates.refresh('2026-11-24');
  const converter = new LoadMoneyConverter(new CurrencySettings(settings), accounts, rates);
  const ids = new SequentialIds();
  return {
    transactions,
    accounts,
    categories,
    converter,
    saveAccount: new SaveAccount(accounts, ids, converter),
    saveTransfer: new SaveTransfer(accounts, ids, converter),
    overview: new GetAccountsOverview(accounts, converter),
  };
}

describe('cuentas en otra moneda', () => {
  it('la moneda principal se guarda como "sin moneda" y la otra queda en la cuenta', async () => {
    const s = await setup();
    expect((await s.saveAccount.execute({ name: 'Popular', type: 'banco', initialBalance: 0, currency: 'DOP' })).currency).toBeNull();
    expect((await s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 0, currency: 'USD' })).currency).toBe('USD');
  });

  it('no deja cambiar la moneda de una cuenta con historial, ni poner Efectivo en otra moneda', async () => {
    const s = await setup();
    const bank = await s.saveAccount.execute({ name: 'Popular', type: 'banco', initialBalance: 0 });
    await s.transactions.save({ id: 't1', date: '2026-11-01', amount: 100, categoryId: 'com', note: '', accountId: bank.id });
    await expect(
      s.saveAccount.execute({ name: 'Popular', type: 'banco', initialBalance: 0, currency: 'USD' }, bank.id),
    ).rejects.toThrow(/historial/);
    await expect(
      s.saveAccount.execute({ name: 'Efectivo', type: 'efectivo', initialBalance: 0, currency: 'USD' }, CASH_ACCOUNT_ID),
    ).rejects.toThrow();
    // Editar otra cosa de la cuenta sí se puede.
    await s.saveAccount.execute({ name: 'Popular nuevo', type: 'banco', initialBalance: 0 }, bank.id);
  });

  it('sin tipo de cambio guardado no deja crear una cuenta en otra moneda', async () => {
    const s = await setup(null);
    await expect(s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 0, currency: 'USD' })).rejects.toThrow();
  });

  it('una transferencia entre monedas pide lo que llega y mueve cada saldo en su moneda', async () => {
    const s = await setup();
    const bank = await s.saveAccount.execute({ name: 'Popular', type: 'banco', initialBalance: 1_000_000 });
    const usd = await s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 0, currency: 'USD' });
    const base = { date: '2026-11-10', amount: 590_000, fromAccountId: bank.id, toAccountId: usd.id };
    await expect(s.saveTransfer.execute(base)).rejects.toThrow();
    await s.saveTransfer.execute({ ...base, toAmount: 10_000 });
    const balances = await s.accounts.balances();
    expect(balances.get(bank.id)).toBe(410_000);
    expect(balances.get(usd.id)).toBe(10_000);
    // Entre cuentas de la misma moneda no se guarda monto de llegada.
    const same = await s.saveTransfer.execute({ ...base, toAccountId: CASH_ACCOUNT_ID, toAmount: 5 });
    expect(same.toAmount).toBeNull();
  });

  it('los totales suman cada cuenta pasada a la moneda principal', async () => {
    const s = await setup();
    await s.saveAccount.execute({ name: 'Popular', type: 'banco', initialBalance: 100_000 });
    await s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 1_000, currency: 'USD' });
    await s.saveAccount.execute({ name: 'Visa', type: 'tarjeta', initialBalance: -500, creditLimit: 100_000, cutDay: 1, dueDay: 20, currency: 'USD' });
    const o = await s.overview.execute();
    expect(o.assets).toBe(100_000 + 60_000);
    expect(o.cardDebt).toBe(30_000);
    // Cada cuenta conserva su saldo en su moneda.
    expect(o.accounts.find((v) => v.account.name === 'Ahorro')?.balance).toBe(1_000);
  });

  it('los resúmenes del mes convierten los movimientos de cuentas en otra moneda, también sus divisiones', async () => {
    const s = await setup();
    const usd = await s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 0, currency: 'USD' });
    await s.transactions.save({ id: 'a', date: '2026-11-02', amount: 1_000_000, categoryId: 'sal', note: '' });
    await s.transactions.save({
      id: 'b',
      date: '2026-11-03',
      amount: 1_001,
      categoryId: 'com',
      note: '',
      accountId: usd.id,
      splits: [
        { categoryId: 'com', amount: 667 },
        { categoryId: 'sal', amount: 334 },
      ],
    });
    const inMain = new MainCurrencyTransactions(s.transactions, s.converter);
    const list = await inMain.listByMonth('2026-11');
    const b = list.find((t) => t.id === 'b')!;
    expect(b.amount).toBe(60_060);
    expect(b.splits!.reduce((sum, p) => sum + p.amount, 0)).toBe(60_060);
    const summary = summarizeMonth('2026-11', list, [...s.categories.items.values()], []);
    expect(summary.expenses).toBe(667 * 60);
    expect(summary.income).toBe(1_000_000 + 60_060 - 667 * 60);
    // Lo guardado no cambia.
    expect((await s.transactions.get('b'))!.amount).toBe(1_001);
    await expect(inMain.save()).rejects.toThrow();
  });

  it('Inicio suma en la moneda principal, pero "Recientes" trae cada movimiento tal como se guardó', async () => {
    const s = await setup();
    const usd = await s.saveAccount.execute({ name: 'Ahorro', type: 'ahorro', initialBalance: 0, currency: 'USD' });
    await s.transactions.save({ id: 'u', date: '2026-11-03', amount: 1_000, categoryId: 'com', note: 'Amazon', accountId: usd.id });
    const overview = await new GetMonthOverview(
      new MainCurrencyTransactions(s.transactions, s.converter),
      s.categories,
      new InMemorySavings(),
      s.transactions,
    ).execute('2026-11');
    expect(overview.summary.expenses).toBe(60_000);
    // Si "Recientes" trajera el monto convertido, editarlo desde Inicio lo guardaría convertido.
    expect(overview.recent[0].transaction.amount).toBe(1_000);
  });
});
