import {
  IAccountRepository,
  IBudgetRepository,
  ICategoryRepository,
  IDebtRepository,
  IRecurringExpenseRepository,
  ISavingsRepository,
  ISettingsRepository,
  ITransactionRepository,
} from '../../application/ports/repositories';
import { Budget } from '../../domain/budget';
import { Account, AccountType, CASH_ACCOUNT_ID, Transfer } from '../../domain/account';
import { Category, CategoryType } from '../../domain/category';
import { Debt, DebtDirection, DebtPayment } from '../../domain/debts';
import { MonthKey } from '../../domain/month';
import {
  Frequency,
  PaymentStatus,
  RecurringExpense,
  RecurringExpenseInstance,
} from '../../domain/recurring-expense';
import { SavingsContribution, SavingsGoal } from '../../domain/savings';
import { Attachment, Transaction } from '../../domain/transaction';
import { SqlDatabase } from '../sqlite/sql-database';

/** Rango de fechas ISO del mes; la comparación de texto 'YYYY-MM-DD' respeta el orden cronológico. */
function monthRange(month: MonthKey): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

interface CategoryRow {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  hidden: number;
}

function toCategory(r: CategoryRow): Category {
  return { id: r.id, name: r.name, type: r.type, icon: r.icon ?? undefined, color: r.color ?? undefined, hidden: r.hidden === 1 };
}

export class SqliteCategoryRepository implements ICategoryRepository {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<Category[]> {
    return (await this.db.all<CategoryRow>('SELECT * FROM categories ORDER BY name')).map(toCategory);
  }

  async get(id: string): Promise<Category | undefined> {
    const rows = await this.db.all<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
    return rows[0] && toCategory(rows[0]);
  }

  async save(c: Category): Promise<void> {
    await this.db.run(
      `INSERT INTO categories (id, name, type, icon, color, hidden) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, icon = excluded.icon,
         color = excluded.color, hidden = excluded.hidden`,
      [c.id, c.name, c.type satisfies CategoryType, c.icon ?? null, c.color ?? null, c.hidden ? 1 : 0],
    );
  }

  async deleteMovingTo(id: string, toId: string): Promise<void> {
    const p = { from: id, to: toId };
    await this.db.batch([
      // Un movimiento dividido que ya tenía parte en la categoría destino: se suman las dos partes.
      {
        sql: `UPDATE transaction_splits SET amount = amount + (
                SELECT s.amount FROM transaction_splits s
                WHERE s.transaction_id = transaction_splits.transaction_id AND s.category_id = ?)
              WHERE category_id = ? AND transaction_id IN (SELECT transaction_id FROM transaction_splits WHERE category_id = ?)`,
        params: [p.from, p.to, p.from],
      },
      {
        sql: `DELETE FROM transaction_splits WHERE category_id = ?
              AND transaction_id IN (SELECT transaction_id FROM transaction_splits WHERE category_id = ?)`,
        params: [p.from, p.to],
      },
      { sql: 'UPDATE transaction_splits SET category_id = ? WHERE category_id = ?', params: [p.to, p.from] },
      { sql: 'UPDATE transactions SET category_id = ? WHERE category_id = ?', params: [p.to, p.from] },
      { sql: 'UPDATE recurring_expenses SET category_id = ? WHERE category_id = ?', params: [p.to, p.from] },
      { sql: 'DELETE FROM categories WHERE id = ?', params: [p.from] },
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM categories WHERE id = ?', [id]);
  }

  async isInUse(id: string): Promise<boolean> {
    const rows = await this.db.all<{ used: number }>(
      `SELECT EXISTS (SELECT 1 FROM transactions WHERE category_id = ?)
           OR EXISTS (SELECT 1 FROM transaction_splits WHERE category_id = ?)
           OR EXISTS (SELECT 1 FROM recurring_expenses WHERE category_id = ?) AS used`,
      [id, id, id],
    );
    return rows[0]?.used === 1;
  }
}

interface TransactionRow {
  id: string;
  date: string;
  amount: number;
  category_id: string;
  note: string;
  tags: string;
  account_id: string;
}

// ponytail: etiquetas en una columna separada por comas; tabla propia si algún día hay que renombrarlas en bloque.
const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  date: r.date,
  amount: r.amount,
  categoryId: r.category_id,
  note: r.note,
  accountId: r.account_id,
  tags: r.tags ? r.tags.split(',') : [],
  splits: [],
  attachmentCount: 0,
});

/** Parámetros por consulta IN (...): SQLite admite 999; se trabaja por tandas más chicas. */
const CHUNK = 500;

export class SqliteTransactionRepository implements ITransactionRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listByMonth(month: MonthKey): Promise<Transaction[]> {
    return this.hydrate(
      await this.db.all<TransactionRow>(
        'SELECT * FROM transactions WHERE date >= ? AND date <= ? ORDER BY date, id',
        monthRange(month),
      ),
    );
  }

  async listAll(): Promise<Transaction[]> {
    return this.hydrate(await this.db.all<TransactionRow>('SELECT * FROM transactions ORDER BY date, id'));
  }

  async get(id: string): Promise<Transaction | undefined> {
    const [t] = await this.hydrate(
      await this.db.all<TransactionRow>('SELECT * FROM transactions WHERE id = ?', [id]),
    );
    return t;
  }

  /** Movimiento, etiquetas y partes en una sola transacción: nunca queda un movimiento con partes viejas. */
  async save(t: Transaction): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO transactions (id, date, amount, category_id, note, tags, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET date = excluded.date, amount = excluded.amount, account_id = excluded.account_id,
                category_id = excluded.category_id, note = excluded.note, tags = excluded.tags`,
        params: [t.id, t.date, t.amount, t.categoryId, t.note, (t.tags ?? []).join(','), t.accountId ?? CASH_ACCOUNT_ID],
      },
      { sql: 'DELETE FROM transaction_splits WHERE transaction_id = ?', params: [t.id] },
      ...(t.splits ?? []).map((s) => ({
        sql: 'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)',
        params: [t.id, s.categoryId, s.amount],
      })),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM transactions WHERE id = ?', [id]);
  }

  async listAttachments(transactionId: string): Promise<Attachment[]> {
    const rows = await this.db.all<{ id: string; transaction_id: string; data: string }>(
      'SELECT id, transaction_id, data FROM attachments WHERE transaction_id = ? ORDER BY created_at, id',
      [transactionId],
    );
    return rows.map((r) => ({ id: r.id, transactionId: r.transaction_id, data: r.data }));
  }

  async saveAttachment(a: Attachment): Promise<void> {
    await this.db.run(
      `INSERT INTO attachments (id, transaction_id, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [a.id, a.transactionId, a.data, new Date().toISOString()],
    );
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.db.run('DELETE FROM attachments WHERE id = ?', [id]);
  }

  /** Agrega las partes y el conteo de fotos de cada movimiento. */
  private async hydrate(rows: TransactionRow[]): Promise<Transaction[]> {
    const list = rows.map(toTransaction);
    const byId = new Map(list.map((t) => [t.id, t]));
    for (let i = 0; i < list.length; i += CHUNK) {
      const ids = list.slice(i, i + CHUNK).map((t) => t.id);
      const marks = ids.map(() => '?').join(', ');
      const splits = await this.db.all<{ transaction_id: string; category_id: string; amount: number }>(
        `SELECT * FROM transaction_splits WHERE transaction_id IN (${marks}) ORDER BY amount DESC`,
        ids,
      );
      for (const s of splits) byId.get(s.transaction_id)!.splits!.push({ categoryId: s.category_id, amount: s.amount });
      const counts = await this.db.all<{ transaction_id: string; n: number }>(
        `SELECT transaction_id, COUNT(*) AS n FROM attachments WHERE transaction_id IN (${marks}) GROUP BY transaction_id`,
        ids,
      );
      for (const c of counts) byId.get(c.transaction_id)!.attachmentCount = c.n;
    }
    return list;
  }
}

interface RecurringRow {
  id: string;
  name: string;
  amount: number;
  category_id: string;
  due_day: number;
  active: number;
  start_month: string;
  frequency: number;
  paused_until: string | null;
  account_id: string | null;
  debt_id: string | null;
}

interface InstanceRow {
  recurring_expense_id: string;
  month: string;
  due_date: string;
  amount: number;
  status: PaymentStatus;
  transaction_id: string | null;
}

const toRecurring = (r: RecurringRow): RecurringExpense => ({
  id: r.id,
  name: r.name,
  amount: r.amount,
  categoryId: r.category_id,
  dueDay: r.due_day,
  active: r.active === 1,
  startMonth: r.start_month,
  frequency: (r.frequency ?? 1) as Frequency,
  pausedUntil: r.paused_until,
  accountId: r.account_id,
  debtId: r.debt_id ?? null,
});

const toInstance = (r: InstanceRow): RecurringExpenseInstance => ({
  recurringExpenseId: r.recurring_expense_id,
  month: r.month,
  dueDate: r.due_date,
  amount: r.amount,
  status: r.status,
  ...(r.transaction_id ? { transactionId: r.transaction_id } : {}),
});

export class SqliteRecurringExpenseRepository implements IRecurringExpenseRepository {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<RecurringExpense[]> {
    const rows = await this.db.all<RecurringRow>('SELECT * FROM recurring_expenses ORDER BY due_day, name');
    return rows.map(toRecurring);
  }

  async get(id: string): Promise<RecurringExpense | undefined> {
    const rows = await this.db.all<RecurringRow>('SELECT * FROM recurring_expenses WHERE id = ?', [id]);
    return rows[0] && toRecurring(rows[0]);
  }

  async save(e: RecurringExpense): Promise<void> {
    await this.db.run(
      `INSERT INTO recurring_expenses
         (id, name, amount, category_id, due_day, active, start_month, frequency, paused_until, account_id, debt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount,
         category_id = excluded.category_id, due_day = excluded.due_day, active = excluded.active,
         start_month = excluded.start_month, frequency = excluded.frequency,
         paused_until = excluded.paused_until, account_id = excluded.account_id, debt_id = excluded.debt_id`,
      [e.id, e.name, e.amount, e.categoryId, e.dueDay, e.active ? 1 : 0, e.startMonth, e.frequency ?? 1, e.pausedUntil ?? null, e.accountId ?? null, e.debtId ?? null],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM recurring_expenses WHERE id = ?', [id]);
  }

  async listInstances(month: MonthKey): Promise<RecurringExpenseInstance[]> {
    const rows = await this.db.all<InstanceRow>(
      'SELECT * FROM recurring_instances WHERE month = ? ORDER BY due_date',
      [month],
    );
    return rows.map(toInstance);
  }

  async saveInstance(i: RecurringExpenseInstance): Promise<void> {
    await this.db.run(
      `INSERT INTO recurring_instances
         (recurring_expense_id, month, due_date, amount, status, transaction_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recurring_expense_id, month) DO UPDATE SET due_date = excluded.due_date,
         amount = excluded.amount, status = excluded.status, transaction_id = excluded.transaction_id`,
      [i.recurringExpenseId, i.month, i.dueDate, i.amount, i.status, i.transactionId ?? null],
    );
  }

  async insertInstanceIfMissing(i: RecurringExpenseInstance): Promise<void> {
    await this.db.run(
      // Con la condición dentro de la misma instrucción, una lectura que empezó antes de eliminar el fijo no
      // puede volver a crearlo después.
      `INSERT INTO recurring_instances
         (recurring_expense_id, month, due_date, amount, status, transaction_id)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM recurring_expenses WHERE id = ? AND active = 1)
       ON CONFLICT(recurring_expense_id, month) DO NOTHING`,
      [i.recurringExpenseId, i.month, i.dueDate, i.amount, i.status, i.transactionId ?? null, i.recurringExpenseId],
    );
  }

  async listInstancesOf(expenseId: string): Promise<RecurringExpenseInstance[]> {
    const rows = await this.db.all<InstanceRow>(
      'SELECT * FROM recurring_instances WHERE recurring_expense_id = ? ORDER BY month',
      [expenseId],
    );
    return rows.map(toInstance);
  }

  async deleteInstance(expenseId: string, month: MonthKey): Promise<void> {
    await this.db.run(
      'DELETE FROM recurring_instances WHERE recurring_expense_id = ? AND month = ?',
      [expenseId, month],
    );
  }

  async findInstanceByTransaction(transactionId: string): Promise<RecurringExpenseInstance | undefined> {
    const rows = await this.db.all<InstanceRow>(
      'SELECT * FROM recurring_instances WHERE transaction_id = ?',
      [transactionId],
    );
    return rows[0] && toInstance(rows[0]);
  }
}

interface GoalRow {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
}

interface ContributionRow {
  id: string;
  goal_id: string;
  date: string;
  amount: number;
  withdrawal: number;
  account_id: string | null;
}

const toGoal = (r: GoalRow): SavingsGoal => ({
  id: r.id,
  name: r.name,
  targetAmount: r.target_amount,
  targetDate: r.target_date,
});

const toContribution = (r: ContributionRow): SavingsContribution => ({
  id: r.id,
  goalId: r.goal_id,
  date: r.date,
  amount: r.amount,
  withdrawal: r.withdrawal === 1,
  accountId: r.account_id,
});

export class SqliteSavingsRepository implements ISavingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listGoals(): Promise<SavingsGoal[]> {
    const rows = await this.db.all<GoalRow>('SELECT * FROM savings_goals ORDER BY name');
    return rows.map(toGoal);
  }

  async getGoal(id: string): Promise<SavingsGoal | undefined> {
    const rows = await this.db.all<GoalRow>('SELECT * FROM savings_goals WHERE id = ?', [id]);
    return rows[0] && toGoal(rows[0]);
  }

  async saveGoal(g: SavingsGoal): Promise<void> {
    await this.db.run(
      `INSERT INTO savings_goals (id, name, target_amount, target_date) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, target_amount = excluded.target_amount,
         target_date = excluded.target_date`,
      [g.id, g.name, g.targetAmount, g.targetDate ?? null],
    );
  }

  async deleteGoal(id: string): Promise<void> {
    await this.db.run('DELETE FROM savings_goals WHERE id = ?', [id]);
  }

  async listContributions(): Promise<SavingsContribution[]> {
    const rows = await this.db.all<ContributionRow>(
      'SELECT * FROM savings_contributions ORDER BY date, id',
    );
    return rows.map(toContribution);
  }

  async listContributionsByMonth(month: MonthKey): Promise<SavingsContribution[]> {
    const rows = await this.db.all<ContributionRow>(
      'SELECT * FROM savings_contributions WHERE date >= ? AND date <= ? ORDER BY date, id',
      monthRange(month),
    );
    return rows.map(toContribution);
  }

  async saveContribution(c: SavingsContribution): Promise<void> {
    await this.db.run(
      `INSERT INTO savings_contributions (id, goal_id, date, amount, withdrawal, account_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET goal_id = excluded.goal_id, date = excluded.date,
         amount = excluded.amount, withdrawal = excluded.withdrawal, account_id = excluded.account_id`,
      [c.id, c.goalId, c.date, c.amount, c.withdrawal ? 1 : 0, c.accountId ?? null],
    );
  }

  async deleteContribution(id: string): Promise<void> {
    await this.db.run('DELETE FROM savings_contributions WHERE id = ?', [id]);
  }
}

interface BudgetRow {
  id: string;
  category_id: string;
  month: string;
  limit_amount: number;
  rollover: number;
  name: string | null;
}

export class SqliteBudgetRepository implements IBudgetRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listByMonth(month: MonthKey): Promise<Budget[]> {
    const [rows, extras] = await Promise.all([
      this.db.all<BudgetRow>('SELECT * FROM budgets WHERE month = ?', [month]),
      this.db.all<{ budget_id: string; category_id: string }>(
        `SELECT bc.budget_id, bc.category_id FROM budget_categories bc
           JOIN budgets b ON b.id = bc.budget_id WHERE b.month = ? ORDER BY bc.rowid`,
        [month],
      ),
    ]);
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      extraCategoryIds: extras.filter((e) => e.budget_id === r.id).map((e) => e.category_id),
      name: r.name ?? undefined,
      month: r.month,
      limit: r.limit_amount,
      rollover: r.rollover === 1,
    }));
  }

  async save(b: Budget): Promise<void> {
    // Todo o nada: el presupuesto y la lista de sus categorías extra.
    await this.db.batch([
      {
        sql: `INSERT INTO budgets (id, category_id, month, limit_amount, rollover, name) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, month = excluded.month,
                limit_amount = excluded.limit_amount, rollover = excluded.rollover, name = excluded.name`,
        params: [b.id, b.categoryId, b.month, b.limit, b.rollover ? 1 : 0, b.name?.trim() || null],
      },
      { sql: 'DELETE FROM budget_categories WHERE budget_id = ?', params: [b.id] },
      ...(b.extraCategoryIds ?? []).map((categoryId) => ({
        sql: 'INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)',
        params: [b.id, categoryId],
      })),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM budgets WHERE id = ?', [id]);
  }
}

export class SqliteSettingsRepository implements ISettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get(key: string): Promise<string | undefined> {
    const rows = await this.db.all<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return rows[0]?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}

interface DebtRow {
  id: string;
  name: string;
  direction: DebtDirection;
  principal: number;
  annual_rate: number;
  term_months: number | null;
  start_date: string;
}

interface DebtPaymentRow {
  id: string;
  debt_id: string;
  date: string;
  amount: number;
  principal: number;
  interest: number;
  transaction_id: string | null;
}

const toDebt = (r: DebtRow): Debt => ({
  id: r.id,
  name: r.name,
  direction: r.direction,
  principal: r.principal,
  annualRate: r.annual_rate,
  termMonths: r.term_months,
  startDate: r.start_date,
});

const toDebtPayment = (r: DebtPaymentRow): DebtPayment => ({
  id: r.id,
  debtId: r.debt_id,
  date: r.date,
  amount: r.amount,
  principal: r.principal,
  interest: r.interest,
  ...(r.transaction_id ? { transactionId: r.transaction_id } : {}),
});

export class SqliteDebtRepository implements IDebtRepository {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<Debt[]> {
    return (await this.db.all<DebtRow>('SELECT * FROM debts ORDER BY start_date, name')).map(toDebt);
  }

  async get(id: string): Promise<Debt | undefined> {
    const rows = await this.db.all<DebtRow>('SELECT * FROM debts WHERE id = ?', [id]);
    return rows[0] && toDebt(rows[0]);
  }

  async save(d: Debt): Promise<void> {
    await this.db.run(
      `INSERT INTO debts (id, name, direction, principal, annual_rate, term_months, start_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, direction = excluded.direction,
         principal = excluded.principal, annual_rate = excluded.annual_rate,
         term_months = excluded.term_months, start_date = excluded.start_date`,
      [d.id, d.name, d.direction, d.principal, d.annualRate, d.termMonths, d.startDate],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM debts WHERE id = ?', [id]);
  }

  async listPayments(debtId?: string): Promise<DebtPayment[]> {
    const rows = debtId
      ? await this.db.all<DebtPaymentRow>('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY date, id', [debtId])
      : await this.db.all<DebtPaymentRow>('SELECT * FROM debt_payments ORDER BY date, id');
    return rows.map(toDebtPayment);
  }

  async savePayment(p: DebtPayment): Promise<void> {
    await this.db.run(
      `INSERT INTO debt_payments (id, debt_id, date, amount, principal, interest, transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.debtId, p.date, p.amount, p.principal, p.interest, p.transactionId ?? null],
    );
  }

  async deletePayment(id: string): Promise<void> {
    await this.db.run('DELETE FROM debt_payments WHERE id = ?', [id]);
  }
}

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  initial_balance: number;
  credit_limit: number | null;
  cut_day: number | null;
  due_day: number | null;
  archived: number;
  card_last4: string | null;
}

interface TransferRow {
  id: string;
  date: string;
  amount: number;
  from_account: string;
  to_account: string;
  note: string;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  type: r.type,
  initialBalance: r.initial_balance,
  creditLimit: r.credit_limit,
  cutDay: r.cut_day,
  dueDay: r.due_day,
  archived: r.archived === 1,
  cardLast4: r.card_last4,
});

const toTransfer = (r: TransferRow): Transfer => ({
  id: r.id,
  date: r.date,
  amount: r.amount,
  fromAccountId: r.from_account,
  toAccountId: r.to_account,
  note: r.note,
});

export class SqliteAccountRepository implements IAccountRepository {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<Account[]> {
    // Efectivo primero, luego por tipo y nombre.
    return (
      await this.db.all<AccountRow>(`SELECT * FROM accounts WHERE id <> 'acc-ajuste' ORDER BY id <> 'acc-efectivo', type, name`)
    ).map(toAccount);
  }

  async get(id: string): Promise<Account | undefined> {
    const rows = await this.db.all<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
    return rows[0] && toAccount(rows[0]);
  }

  async save(a: Account): Promise<void> {
    await this.db.run(
      `INSERT INTO accounts (id, name, type, initial_balance, credit_limit, cut_day, due_day, archived, card_last4)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type,
         initial_balance = excluded.initial_balance, credit_limit = excluded.credit_limit,
         cut_day = excluded.cut_day, due_day = excluded.due_day, archived = excluded.archived,
         card_last4 = excluded.card_last4`,
      [a.id, a.name, a.type, a.initialBalance, a.creditLimit ?? null, a.cutDay ?? null, a.dueDay ?? null, a.archived ? 1 : 0, a.cardLast4 ?? null],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM accounts WHERE id = ?', [id]);
  }

  async isInUse(id: string): Promise<boolean> {
    const rows = await this.db.all<{ used: number }>(
      `SELECT EXISTS (SELECT 1 FROM transactions WHERE account_id = ?)
           OR EXISTS (SELECT 1 FROM transfers WHERE from_account = ? OR to_account = ?)
           OR EXISTS (SELECT 1 FROM recurring_expenses WHERE account_id = ?)
           OR EXISTS (SELECT 1 FROM savings_contributions WHERE account_id = ?) AS used`,
      [id, id, id, id, id],
    );
    return rows[0]?.used === 1;
  }

  async balances(upTo?: string): Promise<Map<string, number>> {
    const until = upTo ?? '9999-12-31';
    const rows = await this.db.all<{ id: string; balance: number }>(
      `SELECT a.id, a.initial_balance
         + COALESCE((SELECT SUM(CASE WHEN c.type = 'ingreso' THEN t.amount ELSE -t.amount END)
                     FROM transactions t JOIN categories c ON c.id = t.category_id
                     WHERE t.account_id = a.id AND t.date <= ?), 0)
         + COALESCE((SELECT SUM(amount) FROM transfers WHERE to_account = a.id AND date <= ?), 0)
         - COALESCE((SELECT SUM(amount) FROM transfers WHERE from_account = a.id AND date <= ?), 0)
         - COALESCE((SELECT SUM(CASE WHEN withdrawal = 1 THEN -amount ELSE amount END)
                     FROM savings_contributions WHERE account_id = a.id AND date <= ?), 0) AS balance
       FROM accounts a WHERE a.id <> 'acc-ajuste'`,
      [until, until, until, until],
    );
    return new Map(rows.map((r) => [r.id, r.balance]));
  }

  async listTransfers(month?: string): Promise<Transfer[]> {
    const rows = month
      ? await this.db.all<TransferRow>(
          'SELECT * FROM transfers WHERE date >= ? AND date <= ? ORDER BY date DESC, id',
          [`${month}-01`, `${month}-31`],
        )
      : await this.db.all<TransferRow>('SELECT * FROM transfers ORDER BY date DESC, id');
    return rows.map(toTransfer);
  }

  async getTransfer(id: string): Promise<Transfer | undefined> {
    const rows = await this.db.all<TransferRow>('SELECT * FROM transfers WHERE id = ?', [id]);
    return rows[0] && toTransfer(rows[0]);
  }

  async saveTransfer(t: Transfer): Promise<void> {
    await this.db.run(
      `INSERT INTO transfers (id, date, amount, from_account, to_account, note) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET date = excluded.date, amount = excluded.amount,
         from_account = excluded.from_account, to_account = excluded.to_account, note = excluded.note`,
      [t.id, t.date, t.amount, t.fromAccountId, t.toAccountId, t.note],
    );
  }

  async deleteTransfer(id: string): Promise<void> {
    await this.db.run('DELETE FROM transfers WHERE id = ?', [id]);
  }
}
