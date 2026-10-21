import { InjectionToken } from '@angular/core';
import { AddRecurringExpense, AddRecurringExpenses } from './application/use-cases/add-recurring-expense';
import { DeleteTransaction, RestoreTransaction } from './application/use-cases/delete-transaction';
import { RemoveRecurringExpense } from './application/use-cases/remove-recurring-expense';
import { UpdateRecurringExpense } from './application/use-cases/update-recurring-expense';
import { UpdateTransaction } from './application/use-cases/update-transaction';
import { AddSavingsGoal } from './application/use-cases/add-savings-goal';
import { AddCategory, DeleteCategory, UpdateCategory } from './application/use-cases/manage-categories';
import {
  AdjustAccountBalance,
  ArchiveAccount,
  DeleteAccount,
  DeleteTransfer,
  GetAccountsOverview,
  GetCardStatuses,
  GetCardsToPay,
  GetNetWorth,
  SaveAccount,
  SetCardMinimum,
  SaveTransfer,
} from './application/use-cases/accounts';
import { AutoBackup, CreateBackup, OpenBackup, RestoreBackup, WipeAllData } from './application/use-cases/backup';
import { CanAfford } from './application/use-cases/can-afford';
import { GetMonthRecap } from './application/use-cases/get-month-recap';
import { CopyFromMonth } from './application/use-cases/copy-month';
import { LocalizeDefaultNames } from './application/use-cases/localize-defaults';
import { ImportTransactions } from './application/use-cases/import-transactions';
import { ExportTransactionsCsv } from './application/use-cases/export-csv';
import { PinLock } from './application/use-cases/pin-lock';
import { BulkUpdateTransactions } from './application/use-cases/bulk-update-transactions';
import {
  AddDebtAsFixed,
  DeleteDebt,
  DeleteDebtPayment,
  GetDebtsOverview,
  RegisterDebtPayment,
  SaveDebt,
} from './application/use-cases/debts';
import { CompleteOnboarding, Onboarding } from './application/use-cases/onboarding';
import { UserProfile } from './application/use-cases/user-profile';
import { GetAlerts } from './application/use-cases/get-alerts';
import { GetMonthHistory } from './application/use-cases/get-month-history';
import { GetReport } from './application/use-cases/get-report';
import { GetSubscriptionCost } from './application/use-cases/get-subscription-cost';
import { GetDebtInstallments } from './application/use-cases/get-debt-installments';
import { GetNotificationPlan } from './application/use-cases/get-notification-plan';
import { GetUpcomingRecurring } from './application/use-cases/get-upcoming-recurring';
import { PauseRecurringExpense, ResumeRecurringExpense } from './application/use-cases/pause-recurring-expense';
import { CurrencySettings } from './application/use-cases/currency-settings';
import { CopyBudgets } from './application/use-cases/copy-budgets';
import { DeleteBudget } from './application/use-cases/delete-budget';
import {
  DeleteSavingsContribution,
  RestoreSavingsContribution,
} from './application/use-cases/delete-savings-contribution';
import { DeleteSavingsGoal } from './application/use-cases/delete-savings-goal';
import { GetSavingsOverview } from './application/use-cases/get-savings-overview';
import { SetBudget } from './application/use-cases/set-budget';
import { UpdateSavingsGoal } from './application/use-cases/update-savings-goal';
import { AddSavingsContribution } from './application/use-cases/add-savings-contribution';
import { AddTransaction } from './application/use-cases/add-transaction';
import { GetBudgetStatuses } from './application/use-cases/get-budget-statuses';
import { GetMonthOverview } from './application/use-cases/get-month-overview';
import { GetMonthRecurringExpenses } from './application/use-cases/get-month-recurring-expenses';
import { PayRecurringExpense } from './application/use-cases/pay-recurring-expense';
import {
  BackupData,
  IAccountRepository,
  IBackupStore,
  IBudgetRepository,
  ICategoryRepository,
  IDebtRepository,
  IdGenerator,
  IRecurringExpenseRepository,
  ISavingsRepository,
  ISettingsRepository,
  ITransactionRepository,
} from './application/ports/repositories';
import {
  SqliteBudgetRepository,
  SqliteAccountRepository,
  SqliteCategoryRepository,
  SqliteDebtRepository,
  SqliteRecurringExpenseRepository,
  SqliteSavingsRepository,
  SqliteSettingsRepository,
  SqliteTransactionRepository,
} from './infrastructure/repositories/sqlite-repositories';
import { SecureSecrets } from './infrastructure/secure-secrets';
import { SqliteBackupStore } from './infrastructure/sqlite/sqlite-backup-store';
import { CapacitorSqliteDatabase } from './infrastructure/sqlite/capacitor-sqlite-database';
import { runMigrations } from './infrastructure/sqlite/migrations';

export interface Repositories {
  categories: ICategoryRepository;
  transactions: ITransactionRepository;
  recurring: IRecurringExpenseRepository;
  savings: ISavingsRepository;
  budgets: IBudgetRepository;
  settings: ISettingsRepository;
  backup: IBackupStore;
  debts: IDebtRepository;
  accounts: IAccountRepository;
  /** Contraseñas que no deben quedar en la base (la del respaldo automático). */
  secrets: ISettingsRepository;
}

/** Raíz de composición: une repositorios y casos de uso. La UI solo ve esto. */
export interface AppContainer {
  categories: ICategoryRepository;
  transactions: ITransactionRepository;
  addTransaction: AddTransaction;
  copyFromMonth: CopyFromMonth;
  localizeDefaults: LocalizeDefaultNames;
  importTransactions: ImportTransactions;
  updateTransaction: UpdateTransaction;
  deleteTransaction: DeleteTransaction;
  addRecurringExpense: AddRecurringExpense;
  addRecurringExpenses: AddRecurringExpenses;
  updateRecurringExpense: UpdateRecurringExpense;
  removeRecurringExpense: RemoveRecurringExpense;
  getMonthOverview: GetMonthOverview;
  getMonthRecurringExpenses: GetMonthRecurringExpenses;
  payRecurringExpense: PayRecurringExpense;
  getSavingsOverview: GetSavingsOverview;
  addSavingsGoal: AddSavingsGoal;
  updateSavingsGoal: UpdateSavingsGoal;
  deleteSavingsGoal: DeleteSavingsGoal;
  addSavingsContribution: AddSavingsContribution;
  deleteSavingsContribution: DeleteSavingsContribution;
  getBudgetStatuses: GetBudgetStatuses;
  setBudget: SetBudget;
  deleteBudget: DeleteBudget;
  copyBudgets: CopyBudgets;
  currencySettings: CurrencySettings;
  addCategory: AddCategory;
  updateCategory: UpdateCategory;
  deleteCategory: DeleteCategory;
  restoreTransaction: RestoreTransaction;
  restoreSavingsContribution: RestoreSavingsContribution;
  createBackup: CreateBackup;
  openBackup: OpenBackup;
  restoreBackup: RestoreBackup;
  wipeAllData: WipeAllData;
  autoBackup: AutoBackup;
  accounts: IAccountRepository;
  saveAccount: SaveAccount;
  archiveAccount: ArchiveAccount;
  deleteAccount: DeleteAccount;
  adjustAccountBalance: AdjustAccountBalance;
  getAccountsOverview: GetAccountsOverview;
  getCardStatuses: GetCardStatuses;
  getNetWorth: GetNetWorth;
  getCardsToPay: GetCardsToPay;
  canAfford: CanAfford;
  setCardMinimum: SetCardMinimum;
  saveTransfer: SaveTransfer;
  deleteTransfer: DeleteTransfer;
  exportCsv: ExportTransactionsCsv;
  pinLock: PinLock;
  bulkUpdateTransactions: BulkUpdateTransactions;
  settings: ISettingsRepository;
  pauseRecurringExpense: PauseRecurringExpense;
  resumeRecurringExpense: ResumeRecurringExpense;
  getUpcomingRecurring: GetUpcomingRecurring;
  saveDebt: SaveDebt;
  deleteDebt: DeleteDebt;
  getDebtsOverview: GetDebtsOverview;
  registerDebtPayment: RegisterDebtPayment;
  deleteDebtPayment: DeleteDebtPayment;
  addDebtAsFixed: AddDebtAsFixed;
  onboarding: Onboarding;
  completeOnboarding: CompleteOnboarding;
  profile: UserProfile;
  getAlerts: GetAlerts;
  getNotificationPlan: GetNotificationPlan;
  getMonthHistory: GetMonthHistory;
  getMonthRecap: GetMonthRecap;
  getReport: GetReport;
  getSubscriptionCost: GetSubscriptionCost;
  getDebtInstallments: GetDebtInstallments;
}

export const APP_CONTAINER = new InjectionToken<AppContainer>('AppContainer');

export const uuidGenerator: IdGenerator = { next: () => crypto.randomUUID() };

export function buildContainer(repos: Repositories, ids: IdGenerator = uuidGenerator): AppContainer {
  const getMonthRecurringExpenses = new GetMonthRecurringExpenses(repos.recurring);
  const createBackup = new CreateBackup(repos.backup);
  const addTransaction = new AddTransaction(repos.transactions, repos.categories, ids, repos.accounts);
  const addRecurringExpenses = new AddRecurringExpenses(repos.recurring, repos.categories, ids);
  const addSavingsGoal = new AddSavingsGoal(repos.savings, ids);
  const currencySettings = new CurrencySettings(repos.settings);
  const saveAccount = new SaveAccount(repos.accounts, ids);
  const adjustAccountBalance = new AdjustAccountBalance(repos.accounts, ids);
  const saveDebt = new SaveDebt(repos.debts, ids);
  const profile = new UserProfile(repos.settings);
  const onboarding = new Onboarding(repos.settings, repos.transactions, repos.recurring);
  const getCardStatuses = new GetCardStatuses(repos.accounts, repos.settings);
  const getDebtsOverview = new GetDebtsOverview(repos.debts, repos.recurring);
  const addDebtAsFixed = new AddDebtAsFixed(getDebtsOverview, repos.recurring, repos.categories, ids);
  const getAccountsOverview = new GetAccountsOverview(repos.accounts);
  const getBudgetStatuses = new GetBudgetStatuses(repos.budgets, repos.transactions);
  const getUpcomingRecurring = new GetUpcomingRecurring(getMonthRecurringExpenses);
  const getMonthHistory = new GetMonthHistory(repos.transactions, repos.categories, repos.savings);
  return {
    categories: repos.categories,
    transactions: repos.transactions,
    addTransaction,
    copyFromMonth: new CopyFromMonth(repos.transactions, repos.categories, repos.recurring, repos.debts, addTransaction),
    localizeDefaults: new LocalizeDefaultNames(repos.categories, repos.accounts),
    importTransactions: new ImportTransactions(
      repos.transactions,
      repos.categories,
      repos.accounts,
      repos.settings,
      addTransaction,
      new AddCategory(repos.categories, ids),
      saveAccount,
    ),
    updateTransaction: new UpdateTransaction(repos.transactions, repos.categories, repos.accounts),
    deleteTransaction: new DeleteTransaction(repos.transactions, repos.recurring, repos.debts),
    addRecurringExpense: new AddRecurringExpense(repos.recurring, repos.categories, ids),
    addRecurringExpenses,
    updateRecurringExpense: new UpdateRecurringExpense(repos.recurring, repos.categories),
    removeRecurringExpense: new RemoveRecurringExpense(repos.recurring),
    getMonthOverview: new GetMonthOverview(repos.transactions, repos.categories, repos.savings),
    getDebtInstallments: new GetDebtInstallments(getDebtsOverview),
    getSubscriptionCost: new GetSubscriptionCost(repos.recurring, repos.categories),
    getReport: new GetReport(repos.transactions, repos.categories, repos.savings, repos.accounts, getMonthRecurringExpenses),
    getMonthHistory,
    getMonthRecap: new GetMonthRecap(repos.transactions, repos.categories, getMonthHistory),
    getMonthRecurringExpenses,
    payRecurringExpense: new PayRecurringExpense(repos.recurring, repos.transactions, ids, repos.debts),
    getSavingsOverview: new GetSavingsOverview(repos.savings),
    addSavingsGoal,
    updateSavingsGoal: new UpdateSavingsGoal(repos.savings),
    deleteSavingsGoal: new DeleteSavingsGoal(repos.savings),
    addSavingsContribution: new AddSavingsContribution(repos.savings, ids, repos.accounts),
    deleteSavingsContribution: new DeleteSavingsContribution(repos.savings),
    getBudgetStatuses,
    setBudget: new SetBudget(repos.budgets, repos.categories, ids),
    deleteBudget: new DeleteBudget(repos.budgets),
    copyBudgets: new CopyBudgets(repos.budgets, ids),
    currencySettings,
    addCategory: new AddCategory(repos.categories, ids),
    updateCategory: new UpdateCategory(repos.categories),
    deleteCategory: new DeleteCategory(repos.categories),
    restoreTransaction: new RestoreTransaction(repos.transactions, repos.recurring, repos.debts),
    restoreSavingsContribution: new RestoreSavingsContribution(repos.savings),
    createBackup,
    openBackup: new OpenBackup(),
    restoreBackup: new RestoreBackup(repos.backup),
    wipeAllData: new WipeAllData(repos.backup),
    autoBackup: new AutoBackup(repos.settings, createBackup, repos.secrets),
    accounts: repos.accounts,
    saveAccount,
    archiveAccount: new ArchiveAccount(repos.accounts),
    deleteAccount: new DeleteAccount(repos.accounts),
    adjustAccountBalance,
    getAccountsOverview,
    canAfford: new CanAfford(getMonthHistory, getAccountsOverview, getMonthRecurringExpenses, repos.categories),
    setCardMinimum: new SetCardMinimum(repos.settings),
    getNetWorth: new GetNetWorth(getAccountsOverview, getDebtsOverview, repos.savings),
    getCardsToPay: new GetCardsToPay(getAccountsOverview, getCardStatuses),
    getCardStatuses,
    saveTransfer: new SaveTransfer(repos.accounts, ids),
    deleteTransfer: new DeleteTransfer(repos.accounts),
    exportCsv: new ExportTransactionsCsv(repos.transactions, repos.categories),
    pinLock: new PinLock(repos.settings),
    bulkUpdateTransactions: new BulkUpdateTransactions(repos.transactions, repos.categories),
    settings: repos.settings,
    pauseRecurringExpense: new PauseRecurringExpense(repos.recurring),
    resumeRecurringExpense: new ResumeRecurringExpense(repos.recurring),
    getUpcomingRecurring,
    getAlerts: new GetAlerts(getUpcomingRecurring, getBudgetStatuses, repos.categories, getCardStatuses),
    getNotificationPlan: new GetNotificationPlan(getMonthRecurringExpenses, getBudgetStatuses, repos.categories, getCardStatuses),
    saveDebt,
    deleteDebt: new DeleteDebt(repos.debts),
    getDebtsOverview,
    registerDebtPayment: new RegisterDebtPayment(repos.debts, repos.transactions, repos.categories, ids),
    deleteDebtPayment: new DeleteDebtPayment(repos.debts, repos.transactions, repos.recurring),
    addDebtAsFixed,
    profile,
    onboarding,
    completeOnboarding: new CompleteOnboarding(
      onboarding,
      profile,
      currencySettings,
      saveAccount,
      adjustAccountBalance,
      addRecurringExpenses,
      saveDebt,
      addDebtAsFixed,
      addSavingsGoal,
    ),
  };
}

/**
 * Abre la base y la pone al día. Si hay que actualizarla y ya tiene datos, antes entrega una copia
 * a `saveSafetyCopy` (la interfaz la guarda en un archivo) por si la actualización saliera mal.
 */
export async function createSqliteContainer(
  saveSafetyCopy?: (data: BackupData) => Promise<void>,
): Promise<AppContainer> {
  const db = await CapacitorSqliteDatabase.open();
  const backup = new SqliteBackupStore(db);
  const copy = saveSafetyCopy && (await backup.safetyDump());
  // Si guardar la copia falla, se actualiza igual: sin actualizar, la app no podría abrir.
  if (copy) await saveSafetyCopy(copy).catch((e) => console.error('No se pudo guardar la copia previa', e));
  await runMigrations(db);
  const container = buildContainer({
    categories: new SqliteCategoryRepository(db),
    transactions: new SqliteTransactionRepository(db),
    recurring: new SqliteRecurringExpenseRepository(db),
    savings: new SqliteSavingsRepository(db),
    budgets: new SqliteBudgetRepository(db),
    settings: new SqliteSettingsRepository(db),
    backup,
    debts: new SqliteDebtRepository(db),
    accounts: new SqliteAccountRepository(db),
    secrets: new SecureSecrets(),
  });
  await container.autoBackup.migrateLegacyPassword();
  return container;
}
