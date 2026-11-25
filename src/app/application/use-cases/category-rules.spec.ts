import { CASH_ACCOUNT_ID } from '../../domain/account';
import { parseQuickEntry } from '../../domain/quick-entry';
import { matchRule } from '../../domain/rules';
import { InMemoryAccounts, InMemoryCategories, InMemoryCategoryRules, InMemoryTransactions, SequentialIds } from '../testing/in-memory';
import { ValidationError } from '../errors';
import { ApplyRuleToPast, SaveCategoryRule } from './category-rules';

function setup() {
  const categories = new InMemoryCategories();
  categories.items.set('tra', { id: 'tra', name: 'Transporte', type: 'variable' });
  categories.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
  categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
  const transactions = new InMemoryTransactions();
  const accounts = new InMemoryAccounts(transactions, categories);
  const rules = new InMemoryCategoryRules();
  return {
    categories,
    transactions,
    accounts,
    rules,
    save: new SaveCategoryRule(rules, categories, accounts, new SequentialIds()),
    apply: new ApplyRuleToPast(rules, transactions, categories),
  };
}

describe('reglas automáticas', () => {
  it('coinciden sin mayúsculas ni acentos, y gana la más larga', () => {
    const rules = [
      { id: '1', match: 'uber', categoryId: 'tra' },
      { id: '2', match: 'Uber Eats', categoryId: 'com' },
    ];
    expect(matchRule('UBER al trabajo', rules)?.id).toBe('1');
    expect(matchRule('uber eats pizza', rules)?.id).toBe('2');
    expect(matchRule('Café', [{ id: '3', match: 'cafe', categoryId: 'com' }])?.id).toBe('3');
    expect(matchRule('', rules)).toBeUndefined();
    // Una regla cuya categoría ya no se puede usar no cuenta.
    expect(matchRule('uber eats', rules, (id) => id !== 'com')?.id).toBe('1');
  });

  it('validan el texto, la categoría, la cuenta y que no se repita el texto', async () => {
    const s = setup();
    await expect(s.save.execute({ match: ' u ', categoryId: 'tra' })).rejects.toThrow(ValidationError);
    await expect(s.save.execute({ match: 'uber', categoryId: 'nada' })).rejects.toThrow();
    await expect(s.save.execute({ match: 'uber', categoryId: 'tra', accountId: 'nada' })).rejects.toThrow();
    const rule = await s.save.execute({ match: '  Uber   app ', categoryId: 'tra', tag: ' #trabajo, x' });
    expect(rule).toMatchObject({ match: 'Uber app', tag: '#trabajo' });
    await expect(s.save.execute({ match: 'UBER APP', categoryId: 'com' })).rejects.toThrow(ValidationError);
    // Editarla con el mismo texto sí se puede.
    await s.save.execute({ match: 'uber app', categoryId: 'com' }, rule.id);
  });

  it('la frase rápida usa la regla antes que lo aprendido, con su cuenta y su etiqueta', async () => {
    const s = setup();
    await s.accounts.save({ id: 'visa', name: 'Visa', type: 'tarjeta', initialBalance: 0, archived: false });
    const rules = [{ id: 'r', match: 'uber', categoryId: 'tra', accountId: 'visa', tag: 'trabajo' }];
    const history = [{ note: 'uber', categoryId: 'com' }];
    const entry = parseQuickEntry('300 uber', [...s.categories.items.values()], history, { accounts: await s.accounts.list(), rules });
    expect(entry).toMatchObject({ amount: 30000, categoryId: 'tra', accountId: 'visa', tags: ['trabajo'] });
    // La cuenta nombrada en la frase manda.
    const named = parseQuickEntry('300 uber en efectivo', [...s.categories.items.values()], [], { accounts: await s.accounts.list(), rules });
    expect(named.accountId).toBe(CASH_ACCOUNT_ID);
  });

  it('aplicar a lo que ya existe cambia categoría y etiqueta, pero no ingresos, divididos ni cuentas', async () => {
    const s = setup();
    const base = { date: '2026-11-01', amount: 100, accountId: 'x' };
    await s.transactions.save({ ...base, id: 'a', categoryId: 'com', note: 'Uber centro' });
    await s.transactions.save({ ...base, id: 'b', categoryId: 'sal', note: 'reembolso uber' });
    await s.transactions.save({ ...base, id: 'c', categoryId: 'com', note: 'uber', splits: [{ categoryId: 'com', amount: 100 }] });
    await s.transactions.save({ ...base, id: 'd', categoryId: 'com', note: 'pizza' });
    const rule = await s.save.execute({ match: 'uber', categoryId: 'tra', tag: 'viaje' });
    expect(await s.apply.execute(rule.id)).toBe(1);
    expect(await s.transactions.get('a')).toMatchObject({ categoryId: 'tra', tags: ['viaje'], accountId: 'x' });
    expect((await s.transactions.get('b'))!.categoryId).toBe('sal');
    expect((await s.transactions.get('c'))!.categoryId).toBe('com');
    // Otra vez no cambia nada.
    expect(await s.apply.execute(rule.id)).toBe(0);
  });
});
