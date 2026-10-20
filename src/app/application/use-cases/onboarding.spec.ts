import { CASH_ACCOUNT_ID } from '../../domain/account';
import {
  InMemoryAccounts,
  InMemoryCategories,
  InMemoryDebts,
  InMemoryRecurring,
  InMemorySavings,
  InMemorySettings,
  InMemoryTransactions,
  SequentialIds,
} from '../testing/in-memory';
import { AdjustAccountBalance, GetAccountsOverview, SaveAccount } from './accounts';
import { AddRecurringExpenses } from './add-recurring-expense';
import { AddSavingsGoal } from './add-savings-goal';
import { CurrencySettings } from './currency-settings';
import { AddDebtAsFixed, GetDebtsOverview, SaveDebt } from './debts';
import { CompleteOnboarding, Onboarding, OnboardingPlan } from './onboarding';
import { UserProfile } from './user-profile';

describe('preguntas iniciales', () => {
  it('guarda todo lo respondido de una vez, con los fijos en las cuentas nuevas', async () => {
    const categories = new InMemoryCategories();
    categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
    categories.items.set('ren', { id: 'ren', name: 'Alquiler', type: 'fijo' });
    categories.items.set('cat-pago-deudas', { id: 'cat-pago-deudas', name: 'Pago de deudas', type: 'fijo' });
    const transactions = new InMemoryTransactions();
    const recurring = new InMemoryRecurring();
    const debts = new InMemoryDebts();
    const savings = new InMemorySavings();
    const settings = new InMemorySettings();
    const accounts = new InMemoryAccounts(transactions, categories, savings);
    const ids = new SequentialIds();
    const profile = new UserProfile(settings);
    const onboarding = new Onboarding(settings, transactions, recurring);
    const complete = new CompleteOnboarding(
      onboarding,
      profile,
      new CurrencySettings(settings),
      new SaveAccount(accounts, ids),
      new AdjustAccountBalance(accounts, ids),
      new AddRecurringExpenses(recurring, categories, ids),
      new SaveDebt(debts, ids),
      new AddDebtAsFixed(new GetDebtsOverview(debts, recurring), recurring, categories, ids),
      new AddSavingsGoal(savings, ids),
    );

    const plan: OnboardingPlan = {
      firstName: '  Starlyn ',
      lastName: 'Familia',
      currency: 'USD',
      goal: 'ahorrar',
      cash: 150_000,
      accounts: [{ tempId: 'nueva-1', fields: { name: 'Popular', type: 'banco', initialBalance: 2_000_000 } }],
      recurring: [
        [
          { name: 'Sueldo · día 15', amount: 2_500_000, categoryId: 'sal', dueDay: 15, accountId: 'nueva-1', startMonth: '2026-10' },
          { name: 'Sueldo · fin de mes', amount: 2_500_000, categoryId: 'sal', dueDay: 31, accountId: 'nueva-1', startMonth: '2026-10' },
        ],
        [{ name: 'Alquiler', amount: 1_800_000, categoryId: 'ren', dueDay: 5, accountId: CASH_ACCOUNT_ID, startMonth: '2026-10' }],
      ],
      debts: [
        { fields: { name: 'Carro', direction: 'debo', principal: 60_000_000, annualRate: 12, termMonths: 48, startDate: '2026-09-01' }, asFixed: true },
      ],
      goals: [{ name: 'Viaje', targetAmount: 2_000_000 }],
      monthlyLimit: 4_000_000,
    };
    expect(await onboarding.needed()).toBe(true);
    await complete.execute(plan, '2026-10');

    expect(await profile.name()).toBe('Starlyn');
    expect(await profile.lastName()).toBe('Familia');
    expect(await profile.goal()).toBe('ahorrar');
    expect(await profile.monthlyLimit()).toBe(4_000_000);
    expect(await new CurrencySettings(settings).get()).toBe('USD');
    const popular = [...accounts.items.values()].find((a) => a.name === 'Popular')!;
    const fixed = await recurring.list();
    expect(fixed.filter((r) => r.categoryId === 'sal').every((r) => r.accountId === popular.id)).toBe(true);
    // Sueldo (2), alquiler y la cuota del carro.
    expect(fixed.map((r) => r.name)).toHaveLength(4);
    expect(fixed.some((r) => r.debtId)).toBe(true);
    expect((await savings.listGoals()).map((g) => g.name)).toEqual(['Viaje']);
    const overview = await new GetAccountsOverview(accounts).execute();
    expect(overview.accounts.find((v) => v.account.id === CASH_ACCOUNT_ID)?.balance).toBe(150_000);
    expect(await onboarding.needed()).toBe(false);
  });
});
