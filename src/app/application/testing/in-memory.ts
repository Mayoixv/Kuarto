import { Budget } from '../../domain/budget';
import { Category } from '../../domain/category';
import { monthOf, MonthKey } from '../../domain/month';
import { RecurringExpense, RecurringExpenseInstance } from '../../domain/recurring-expense';
import { Account, ADJUST_ACCOUNT_ID, CASH_ACCOUNT_ID, Transfer } from '../../domain/account';
import { Debt, DebtPayment } from '../../domain/debts';
import { SavingsContribution, SavingsGoal, signedAmount } from '../../domain/savings';
import { Attachment, Transaction } from '../../domain/transaction';
import {
  IBudgetRepository,
  IAccountRepository,
  ICategoryRepository,
  IDebtRepository,
  IdGenerator,
  IRecurringExpenseRepository,
  ISavingsRepository,
  ISettingsRepository,
  ITransactionRepository,
} from '../ports/repositories';

/** Dobles en memoria de los puertos, solo para tests. */
export class InMemoryCategories implements ICategoryRepository {
  items = new Map<string, Category>();
  async list() { return [...this.items.values()]; }
  async get(id: string) { return this.items.get(id); }
  async save(c: Category) { this.items.set(c.id, c); }
  async delete(id: string) { this.items.delete(id); }
  /** Los tests marcan aquí qué categorías simulan estar en uso. */
  inUse = new Set<string>();
  async isInUse(id: string) { return this.inUse.has(id); }
  movedTo = new Map<string, string>();
  async deleteMovingTo(id: string, toId: string) { this.movedTo.set(id, toId); this.items.delete(id); }
}

export class InMemoryTransactions implements ITransactionRepository {
  items = new Map<string, Transaction>();
  async listByMonth(month: MonthKey) {
    return [...this.items.values()].filter((t) => monthOf(t.date) === month);
  }
  async listAll() { return [...this.items.values()].sort((a, b) => a.date.localeCompare(b.date)); }
  attachments = new Map<string, Attachment>();
  async listAttachments(transactionId: string) {
    return [...this.attachments.values()].filter((a) => a.transactionId === transactionId);
  }
  async saveAttachment(a: Attachment) { this.attachments.set(a.id, a); }
  async deleteAttachment(id: string) { this.attachments.delete(id); }
  async get(id: string) { return this.items.get(id); }
  async save(t: Transaction) { this.items.set(t.id, t); }
  async delete(id: string) { this.items.delete(id); }
}

export class InMemoryRecurring implements IRecurringExpenseRepository {
  items = new Map<string, RecurringExpense>();
  instances: RecurringExpenseInstance[] = [];
  async list() { return [...this.items.values()]; }
  async get(id: string) { return this.items.get(id); }
  async save(e: RecurringExpense) { this.items.set(e.id, e); }
  async delete(id: string) { this.items.delete(id); }
  async listInstances(month: MonthKey) {
    return this.instances.filter((i) => i.month === month);
  }
  async saveInstance(instance: RecurringExpenseInstance) {
    this.instances = this.instances.filter(
      (i) => !(i.recurringExpenseId === instance.recurringExpenseId && i.month === instance.month),
    );
    this.instances.push(instance);
  }
  async insertInstanceIfMissing(instance: RecurringExpenseInstance) {
    const exists = this.instances.some(
      (i) => i.recurringExpenseId === instance.recurringExpenseId && i.month === instance.month,
    );
    if (!exists && this.items.get(instance.recurringExpenseId)?.active) this.instances.push(instance);
  }
  async listInstancesOf(expenseId: string) {
    return this.instances
      .filter((i) => i.recurringExpenseId === expenseId)
      .sort((a, b) => a.month.localeCompare(b.month));
  }
  async deleteInstance(expenseId: string, month: MonthKey) {
    this.instances = this.instances.filter(
      (i) => !(i.recurringExpenseId === expenseId && i.month === month),
    );
  }
  async findInstanceByTransaction(transactionId: string) {
    return this.instances.find((i) => i.transactionId === transactionId);
  }
}

export class InMemorySavings implements ISavingsRepository {
  goals = new Map<string, SavingsGoal>();
  contributions = new Map<string, SavingsContribution>();
  async listGoals() { return [...this.goals.values()]; }
  async getGoal(id: string) { return this.goals.get(id); }
  async saveGoal(g: SavingsGoal) { this.goals.set(g.id, g); }
  async deleteGoal(id: string) { this.goals.delete(id); }
  async listContributions() { return [...this.contributions.values()]; }
  async listContributionsByMonth(month: MonthKey) {
    return [...this.contributions.values()].filter((c) => monthOf(c.date) === month);
  }
  async saveContribution(c: SavingsContribution) { this.contributions.set(c.id, c); }
  async deleteContribution(id: string) { this.contributions.delete(id); }
}

export class InMemoryBudgets implements IBudgetRepository {
  items = new Map<string, Budget>();
  async listByMonth(month: MonthKey) {
    return [...this.items.values()].filter((b) => b.month === month);
  }
  async save(b: Budget) { this.items.set(b.id, b); }
  async delete(id: string) { this.items.delete(id); }
}

export class InMemorySettings implements ISettingsRepository {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
}

export class InMemoryDebts implements IDebtRepository {
  items = new Map<string, Debt>();
  payments = new Map<string, DebtPayment>();
  async list() { return [...this.items.values()]; }
  async get(id: string) { return this.items.get(id); }
  async save(d: Debt) { this.items.set(d.id, d); }
  async delete(id: string) {
    this.items.delete(id);
    for (const p of [...this.payments.values()]) if (p.debtId === id) this.payments.delete(p.id);
  }
  async listPayments(debtId?: string) {
    return [...this.payments.values()].filter((p) => !debtId || p.debtId === debtId).sort((a, b) => a.date.localeCompare(b.date));
  }
  async savePayment(p: DebtPayment) { this.payments.set(p.id, p); }
  async deletePayment(id: string) { this.payments.delete(id); }
}

export class InMemoryAccounts implements IAccountRepository {
  items = new Map<string, Account>([
    [CASH_ACCOUNT_ID, { id: CASH_ACCOUNT_ID, name: 'Efectivo', type: 'efectivo', initialBalance: 0, archived: false }],
  ]);
  transfers = new Map<string, Transfer>();
  constructor(
    private readonly transactions: InMemoryTransactions,
    private readonly categories: InMemoryCategories,
    private readonly savings?: InMemorySavings,
  ) {}
  async list() { return [...this.items.values()].filter((a) => a.id !== ADJUST_ACCOUNT_ID); }
  async get(id: string) { return this.items.get(id); }
  async save(a: Account) { this.items.set(a.id, a); }
  async delete(id: string) { this.items.delete(id); }
  async isInUse(id: string) {
    return (
      [...this.transactions.items.values()].some((t) => (t.accountId ?? CASH_ACCOUNT_ID) === id) ||
      [...this.transfers.values()].some((t) => t.fromAccountId === id || t.toAccountId === id) ||
      [...(this.savings?.contributions.values() ?? [])].some((c) => c.accountId === id)
    );
  }
  async balances(upTo = '9999-12-31') {
    const out = new Map([...this.items.values()].map((a) => [a.id, a.initialBalance]));
    for (const t of this.transactions.items.values()) {
      if (t.date > upTo) continue;
      const id = t.accountId ?? CASH_ACCOUNT_ID;
      const sign = this.categories.items.get(t.categoryId)?.type === 'ingreso' ? 1 : -1;
      out.set(id, (out.get(id) ?? 0) + sign * t.amount);
    }
    for (const t of this.transfers.values()) {
      if (t.date > upTo) continue;
      out.set(t.fromAccountId, (out.get(t.fromAccountId) ?? 0) - t.amount);
      out.set(t.toAccountId, (out.get(t.toAccountId) ?? 0) + t.amount);
    }
    for (const c of this.savings?.contributions.values() ?? []) {
      if (c.date > upTo || !c.accountId) continue;
      out.set(c.accountId, (out.get(c.accountId) ?? 0) - signedAmount(c));
    }
    out.delete(ADJUST_ACCOUNT_ID);
    return out;
  }
  async listTransfers(month?: string) {
    return [...this.transfers.values()].filter((t) => !month || t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  }
  async getTransfer(id: string) { return this.transfers.get(id); }
  async saveTransfer(t: Transfer) { this.transfers.set(t.id, t); }
  async deleteTransfer(id: string) { this.transfers.delete(id); }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next() { return `id-${++this.n}`; }
}
