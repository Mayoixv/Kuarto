import { Budget } from '../../domain/budget';
import { Category } from '../../domain/category';
import { MonthKey } from '../../domain/month';
import { RecurringExpense, RecurringExpenseInstance } from '../../domain/recurring-expense';
import { Account, Transfer } from '../../domain/account';
import { Debt, DebtPayment } from '../../domain/debts';
import { SavingsContribution, SavingsGoal } from '../../domain/savings';
import { Attachment, Transaction } from '../../domain/transaction';
import { CategoryRule } from '../../domain/rules';

export interface ICategoryRepository {
  list(): Promise<Category[]>;
  get(id: string): Promise<Category | undefined>;
  save(category: Category): Promise<void>;
  delete(id: string): Promise<void>;
  /** true si algún movimiento o gasto fijo usa la categoría (no se puede borrar sin perder datos). */
  isInUse(id: string): Promise<boolean>;
  /** Pasa a `toId` todo lo que usa `id` (movimientos, divisiones y fijos) y la borra, todo o nada. */
  deleteMovingTo(id: string, toId: string): Promise<void>;
}

export interface ITransactionRepository {
  listByMonth(month: MonthKey): Promise<Transaction[]>;
  listAll(): Promise<Transaction[]>;
  listAttachments(transactionId: string): Promise<Attachment[]>;
  saveAttachment(attachment: Attachment): Promise<void>;
  deleteAttachment(id: string): Promise<void>;
  get(id: string): Promise<Transaction | undefined>;
  save(transaction: Transaction): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IRecurringExpenseRepository {
  list(): Promise<RecurringExpense[]>;
  get(id: string): Promise<RecurringExpense | undefined>;
  save(expense: RecurringExpense): Promise<void>;
  delete(id: string): Promise<void>;
  listInstances(month: MonthKey): Promise<RecurringExpenseInstance[]>;
  saveInstance(instance: RecurringExpenseInstance): Promise<void>;
  /** Crea la instancia solo si no existe; nunca pisa una que ya esté (por ejemplo, pagada). */
  insertInstanceIfMissing(instance: RecurringExpenseInstance): Promise<void>;
  listInstancesOf(expenseId: string): Promise<RecurringExpenseInstance[]>;
  deleteInstance(expenseId: string, month: MonthKey): Promise<void>;
  findInstanceByTransaction(transactionId: string): Promise<RecurringExpenseInstance | undefined>;
}

export interface ISavingsRepository {
  listGoals(): Promise<SavingsGoal[]>;
  getGoal(id: string): Promise<SavingsGoal | undefined>;
  saveGoal(goal: SavingsGoal): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  listContributions(): Promise<SavingsContribution[]>;
  listContributionsByMonth(month: MonthKey): Promise<SavingsContribution[]>;
  saveContribution(contribution: SavingsContribution): Promise<void>;
  deleteContribution(id: string): Promise<void>;
}

export interface IBudgetRepository {
  listByMonth(month: MonthKey): Promise<Budget[]>;
  save(budget: Budget): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IAccountRepository {
  list(): Promise<Account[]>;
  get(id: string): Promise<Account | undefined>;
  save(account: Account): Promise<void>;
  delete(id: string): Promise<void>;
  /** Si tiene movimientos, transferencias o fijos asociados (entonces no se borra: se archiva). */
  isInUse(id: string): Promise<boolean>;
  /** Saldo calculado de cada cuenta: inicial + ingresos − gastos ± transferencias, hasta `upTo` inclusive si llega. */
  balances(upTo?: string): Promise<Map<string, number>>;
  listTransfers(month?: string): Promise<Transfer[]>;
  getTransfer(id: string): Promise<Transfer | undefined>;
  saveTransfer(transfer: Transfer): Promise<void>;
  deleteTransfer(id: string): Promise<void>;
}

export interface ICategoryRuleRepository {
  list(): Promise<CategoryRule[]>;
  save(rule: CategoryRule): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IDebtRepository {
  list(): Promise<Debt[]>;
  get(id: string): Promise<Debt | undefined>;
  save(debt: Debt): Promise<void>;
  delete(id: string): Promise<void>;
  listPayments(debtId?: string): Promise<DebtPayment[]>;
  savePayment(payment: DebtPayment): Promise<void>;
  deletePayment(id: string): Promise<void>;
}

/** Preferencias de la app guardadas en el dispositivo, como pares clave/valor. */
export interface ISettingsRepository {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Copia completa de los datos: filas de cada tabla y la versión del esquema que las produjo. */
export interface BackupData {
  schemaVersion: number;
  tables: Record<string, Record<string, string | number | null>[]>;
}

export interface IBackupStore {
  dump(): Promise<BackupData>;
  restore(data: BackupData): Promise<void>;
  /** Deja la base como recién instalada: sin datos ni ajustes, con las categorías por defecto. */
  wipe(): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}
