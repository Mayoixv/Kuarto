import { NodeSqliteDatabase } from './testing/node-sqlite-database';
import { AddRecurringExpense } from '../application/use-cases/add-recurring-expense';
import { GetMonthRecurringExpenses } from '../application/use-cases/get-month-recurring-expenses';
import { PayRecurringExpense } from '../application/use-cases/pay-recurring-expense';
import { RemoveRecurringExpense } from '../application/use-cases/remove-recurring-expense';
import { Migration, MIGRATIONS, runMigrations } from './sqlite/migrations';
import {
  SqliteBudgetRepository,
  SqliteAccountRepository,
  SqliteCategoryRepository,
  SqliteDebtRepository,
  SqliteRecurringExpenseRepository,
  SqliteSavingsRepository,
  SqliteSettingsRepository,
  SqliteTransactionRepository,
} from './repositories/sqlite-repositories';

async function freshDb() {
  const db = new NodeSqliteDatabase();
  await runMigrations(db);
  return db;
}

describe('migraciones', () => {
  it('aplica todo una vez y no repite al volver a correr', async () => {
    const db = new NodeSqliteDatabase();
    expect(await runMigrations(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await runMigrations(db)).toEqual([]);
  });

  it('una migración que falla no deja cambios a medias', async () => {
    const db = await freshDb();
    const broken: Migration = {
      version: 99,
      name: 'rota',
      statements: ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE a (x INTEGER)'],
    };
    await expect(runMigrations(db, [...MIGRATIONS, broken])).rejects.toThrow();
    const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'a'");
    expect(tables).toHaveLength(0);
    const versions = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
    expect(versions.map((v) => v.version)).not.toContain(99);
  });
});

describe('repositorios SQLite', () => {
  it('la migración 2 deja categorías de los tres tipos', async () => {
    const types = new Set((await new SqliteCategoryRepository(await freshDb()).list()).map((c) => c.type));
    expect([...types].sort()).toEqual(['fijo', 'ingreso', 'variable']);
  });

  it('categorías: guarda, actualiza y borra', async () => {
    const repo = new SqliteCategoryRepository(await freshDb());
    await repo.save({ id: 'c1', name: 'Comida', type: 'variable' });
    await repo.save({ id: 'c1', name: 'Supermercado', type: 'variable' });
    expect(await repo.get('c1')).toMatchObject({ id: 'c1', name: 'Supermercado', type: 'variable' });
    await repo.delete('c1');
    expect(await repo.get('c1')).toBeUndefined();
  });

  it('transacciones: filtra por mes, incluidos los bordes', async () => {
    const db = await freshDb();
    await new SqliteCategoryRepository(db).save({ id: 'c1', name: 'Comida', type: 'variable' });
    const repo = new SqliteTransactionRepository(db);
    const t = (id: string, date: string) => ({ id, date, amount: 10, categoryId: 'c1', note: '' });
    await repo.save(t('a', '2026-09-30'));
    await repo.save(t('b', '2026-10-01'));
    await repo.save(t('c', '2026-10-31'));
    await repo.save(t('d', '2026-11-01'));
    expect((await repo.listByMonth('2026-10')).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('no permite una transacción con categoría inexistente ni monto <= 0', async () => {
    const db = await freshDb();
    await new SqliteCategoryRepository(db).save({ id: 'c1', name: 'Comida', type: 'variable' });
    const repo = new SqliteTransactionRepository(db);
    await expect(
      repo.save({ id: 'x', date: '2026-10-01', amount: 5, categoryId: 'nope', note: '' }),
    ).rejects.toThrow();
    await expect(
      repo.save({ id: 'y', date: '2026-10-01', amount: 0, categoryId: 'c1', note: '' }),
    ).rejects.toThrow();
  });

  it('gastos fijos: guarda plantilla e instancia con su transacción', async () => {
    const db = await freshDb();
    await new SqliteCategoryRepository(db).save({ id: 'c1', name: 'Renta', type: 'fijo' });
    await new SqliteTransactionRepository(db).save({
      id: 't1',
      date: '2026-10-05',
      amount: 800,
      categoryId: 'c1',
      note: 'Renta',
    });
    const repo = new SqliteRecurringExpenseRepository(db);
    await repo.save({ id: 'r1', name: 'Renta', amount: 800, categoryId: 'c1', dueDay: 5, active: true, startMonth: '2026-10' });
    expect((await repo.get('r1'))?.active).toBe(true);

    const base = {
      recurringExpenseId: 'r1',
      month: '2026-10',
      dueDate: '2026-10-05',
      amount: 800,
    };
    await repo.saveInstance({ ...base, status: 'pendiente' });
    await repo.saveInstance({ ...base, status: 'pagado', transactionId: 't1' });
    const instances = await repo.listInstances('2026-10');
    expect(instances).toEqual([{ ...base, status: 'pagado', transactionId: 't1' }]);
    expect(await repo.listInstances('2026-11')).toEqual([]);
    expect(await repo.findInstanceByTransaction('t1')).toMatchObject({ month: '2026-10' });
    await repo.insertInstanceIfMissing({ ...base, status: 'pendiente' });
    expect((await repo.listInstances('2026-10'))[0].status).toBe('pagado');
    expect((await repo.listInstancesOf('r1')).map((i) => i.month)).toEqual(['2026-10']);
    await repo.deleteInstance('r1', '2026-10');
    expect(await repo.listInstancesOf('r1')).toEqual([]);
  });

  it('ahorro: borrar una meta borra sus aportes', async () => {
    const repo = new SqliteSavingsRepository(await freshDb());
    await repo.saveGoal({ id: 'g1', name: 'Viaje', targetAmount: 5000 });
    await repo.saveContribution({ id: 'a', goalId: 'g1', date: '2026-10-10', amount: 200 });
    await repo.saveContribution({ id: 'b', goalId: 'g1', date: '2026-11-10', amount: 300 });
    expect(await repo.listContributionsByMonth('2026-10')).toHaveLength(1);
    await repo.deleteGoal('g1');
    expect(await repo.listContributions()).toEqual([]);
  });

  it('presupuestos: uno por categoría y mes', async () => {
    const db = await freshDb();
    await new SqliteCategoryRepository(db).save({ id: 'c1', name: 'Comida', type: 'variable' });
    const repo = new SqliteBudgetRepository(db);
    await repo.save({ id: 'b1', categoryId: 'c1', month: '2026-10', limit: 400 });
    await expect(
      repo.save({ id: 'b2', categoryId: 'c1', month: '2026-10', limit: 500 }),
    ).rejects.toThrow();
    expect(await repo.listByMonth('2026-10')).toMatchObject([
      { id: 'b1', categoryId: 'c1', month: '2026-10', limit: 400 },
    ]);
  });
});

describe('migraciones de montos y ajustes', () => {
  it('la migración 4 pasa a centavos los montos que ya existían', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 3));
    await db.run(`INSERT INTO transactions (id, date, amount, category_id, note) VALUES ('t', '2026-10-01', 12.5, 'cat-comida', '')`);
    await db.run(`INSERT INTO budgets (id, category_id, month, limit_amount) VALUES ('b', 'cat-comida', '2026-10', 0.1)`);
    await runMigrations(db);
    const tx = await new SqliteTransactionRepository(db).get('t');
    expect(tx?.amount).toBe(1250);
    expect((await new SqliteBudgetRepository(db).listByMonth('2026-10'))[0].limit).toBe(10);
  });

  it('los ajustes se guardan y se actualizan por clave', async () => {
    const repo = new SqliteSettingsRepository(await freshDb());
    expect(await repo.get('currency')).toBeUndefined();
    await repo.set('currency', 'USD');
    await repo.set('currency', 'DOP');
    expect(await repo.get('currency')).toBe('DOP');
  });
});

describe('categorías en uso', () => {
  it('isInUse detecta movimientos y gastos fijos', async () => {
    const db = await freshDb();
    const cats = new SqliteCategoryRepository(db);
    expect(await cats.isInUse('cat-comida')).toBe(false);
    await new SqliteTransactionRepository(db).save({ id: 't', date: '2026-10-01', amount: 100, categoryId: 'cat-comida', note: '' });
    expect(await cats.isInUse('cat-comida')).toBe(true);
    await new SqliteRecurringExpenseRepository(db).save({
      id: 'r', name: 'Luz', amount: 100, categoryId: 'cat-servicios', dueDay: 1, active: true, startMonth: '2026-10',
    });
    expect(await cats.isInUse('cat-servicios')).toBe(true);
  });
});

describe('etiquetas, divisiones y fotos en SQLite', () => {
  it('guarda y lee etiquetas y partes, reemplaza las partes al editar y borra todo en cascada', async () => {
    const db = await freshDb();
    const repo = new SqliteTransactionRepository(db);
    const t = {
      id: 't', date: '2026-10-02', amount: 1000, categoryId: 'cat-comida', note: '', tags: ['Viaje', 'Samaná'],
      splits: [{ categoryId: 'cat-comida', amount: 700 }, { categoryId: 'cat-ocio', amount: 300 }],
    };
    await repo.save(t);
    await repo.saveAttachment({ id: 'f', transactionId: 't', data: 'data:image/jpeg;base64,AAA' });
    expect(await repo.get('t')).toEqual({ ...t, attachmentCount: 1, accountId: 'acc-efectivo' });
    expect((await repo.listByMonth('2026-10'))[0].splits).toHaveLength(2);

    await repo.save({ ...t, splits: [] });
    expect((await repo.get('t'))?.splits).toEqual([]);

    expect(await new SqliteCategoryRepository(db).isInUse('cat-ocio')).toBe(false);
    await repo.save(t);
    expect(await new SqliteCategoryRepository(db).isInUse('cat-ocio')).toBe(true);

    await repo.delete('t');
    expect(await repo.listAttachments('t')).toEqual([]);
    expect(await db.all('SELECT * FROM transaction_splits')).toEqual([]);
  });
});

describe('migración 7 en SQLite', () => {
  it('guarda frecuencia y pausa de fijos, fecha de metas, retiros, rollover y deudas con pagos en cascada', async () => {
    const db = await freshDb();
    const rec = new SqliteRecurringExpenseRepository(db);
    await rec.save({ id: 'r', name: 'Seguro', amount: 100, categoryId: 'cat-servicios', dueDay: 1, active: true, startMonth: '2026-10', frequency: 12, pausedUntil: '2026-12' });
    expect(await rec.get('r')).toMatchObject({ frequency: 12, pausedUntil: '2026-12' });

    const sav = new SqliteSavingsRepository(db);
    await sav.saveGoal({ id: 'g', name: 'Viaje', targetAmount: 500, targetDate: '2027-01-01' });
    await sav.saveContribution({ id: 'w', goalId: 'g', date: '2026-10-01', amount: 50, withdrawal: true });
    expect(await sav.getGoal('g')).toMatchObject({ targetDate: '2027-01-01' });
    expect((await sav.listContributions())[0]).toMatchObject({ withdrawal: true });

    const bud = new SqliteBudgetRepository(db);
    await bud.save({ id: 'b', categoryId: 'cat-comida', month: '2026-10', limit: 100, rollover: true });
    expect((await bud.listByMonth('2026-10'))[0].rollover).toBe(true);

    const debts = new SqliteDebtRepository(db);
    await debts.save({ id: 'd', name: 'Carro', direction: 'debo', principal: 1000, annualRate: 12.5, termMonths: 24, startDate: '2026-10-01' });
    await debts.savePayment({ id: 'p', debtId: 'd', date: '2026-10-15', amount: 100, principal: 90, interest: 10 });
    expect(await debts.get('d')).toMatchObject({ annualRate: 12.5, termMonths: 24 });
    expect(await debts.listPayments('d')).toHaveLength(1);
    await debts.delete('d');
    expect(await debts.listPayments()).toEqual([]);
    expect((await new SqliteCategoryRepository(db).get('cat-pago-deudas'))?.type).toBe('fijo');
  });
});

describe('migración 8: cuentas', () => {
  it('pasa los movimientos existentes a Efectivo y calcula saldos con ingresos, gastos y transferencias', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 7));
    await db.run("INSERT INTO transactions (id, date, amount, category_id, note) VALUES ('viejo', '2026-09-01', 70000, 'cat-salario', '')");
    await db.run("INSERT INTO transactions (id, date, amount, category_id, note) VALUES ('viejo2', '2026-09-02', 20000, 'cat-comida', '')");
    await runMigrations(db);

    const tx = new SqliteTransactionRepository(db);
    expect((await tx.get('viejo'))?.accountId).toBe('acc-efectivo');

    const accounts = new SqliteAccountRepository(db);
    expect((await accounts.list()).map((a) => a.name)).toEqual(['Efectivo']);
    await accounts.save({ id: 'b', name: 'Banco', type: 'banco', initialBalance: 1000, archived: false });
    await accounts.save({ id: 'v', name: 'Visa', type: 'tarjeta', initialBalance: 0, creditLimit: 50000, cutDay: 15, dueDay: 5, archived: false });
    await tx.save({ id: 'compra', date: '2026-10-03', amount: 3000, categoryId: 'cat-comida', note: '', accountId: 'v' });
    await accounts.saveTransfer({ id: 'tr', date: '2026-10-04', amount: 500, fromAccountId: 'acc-efectivo', toAccountId: 'b', note: 'depósito' });

    const balances = await accounts.balances();
    expect(balances.get('acc-efectivo')).toBe(70000 - 20000 - 500);
    expect(balances.get('b')).toBe(1500);
    expect(balances.get('v')).toBe(-3000);
    expect((await accounts.balances('2026-10-03')).get('b')).toBe(1000);
    expect(await accounts.listTransfers('2026-10')).toHaveLength(1);
    expect(await accounts.isInUse('v')).toBe(true);
    expect((await accounts.get('v'))?.creditLimit).toBe(50000);
    expect((await accounts.list()).map((a) => a.id)[0]).toBe('acc-efectivo');

    // Un ajuste de saldo mueve la cuenta ajustada; la cuenta interna no sale en listas ni en saldos.
    await accounts.saveTransfer({ id: 'aj', date: '2026-10-05', amount: 200, fromAccountId: 'acc-ajuste', toAccountId: 'b', note: '' });
    const after = await accounts.balances();
    expect(after.get('b')).toBe(1700);
    expect(after.has('acc-ajuste')).toBe(false);
    expect((await accounts.list()).some((a) => a.id === 'acc-ajuste')).toBe(false);
  });
});

describe('fijo eliminado que reaparecía (beta)', () => {
  async function setup() {
    const db = new NodeSqliteDatabase();
    await runMigrations(db);
    const recurring = new SqliteRecurringExpenseRepository(db);
    const transactions = new SqliteTransactionRepository(db);
    const ids = { n: 0, next() { return `id-${++this.n}`; } };
    const categories = new SqliteCategoryRepository(db);
    const add = new AddRecurringExpense(recurring, categories, ids);
    // "Abrir la app" = leer el mes con un caso de uso nuevo sobre la misma base.
    const open = (month: string) => new GetMonthRecurringExpenses(recurring).execute(month);
    const names = async (month: string) => (await open(month)).map((i) => `${i.expense.name}:${i.instance.status}`);
    return { db, recurring, transactions, ids, add, open, names, remove: new RemoveRecurringExpense(recurring) };
  }

  it('crear, eliminar y volver a abrir: no reaparece', async () => {
    const s = await setup();
    const e = await s.add.execute({ name: 'Alquiler', amount: 1_500_000, categoryId: 'cat-alquiler', dueDay: 5, startMonth: '2026-10' });
    await s.open('2026-10');
    await s.open('2026-11');
    expect(await s.remove.execute(e.id, '2026-10', 'forward')).toBe('deleted');
    expect(await s.names('2026-10')).toEqual([]);
    expect(await s.names('2026-11')).toEqual([]);
  });

  it('pagado y luego eliminado en el mismo mes: sale de Fijos y el pago sigue en Movimientos', async () => {
    const s = await setup();
    const e = await s.add.execute({ name: 'Luz', amount: 200_000, categoryId: 'cat-servicios', dueDay: 3, startMonth: '2026-10' });
    await s.open('2026-10');
    await new PayRecurringExpense(s.recurring, s.transactions, s.ids).execute({ recurringExpenseId: e.id, month: '2026-10', paidDate: '2026-10-03' });
    await s.remove.execute(e.id, '2026-10', 'forward');
    expect(await s.names('2026-10')).toEqual([]);
    expect((await s.transactions.listByMonth('2026-10')).map((t) => t.note)).toEqual(['Luz']);
  });

  it('eliminado mirando un mes posterior: no queda pendiente el mes anterior; lo pagado antes se conserva', async () => {
    const s = await setup();
    const e = await s.add.execute({ name: 'Internet', amount: 150_000, categoryId: 'cat-servicios', dueDay: 20, startMonth: '2026-09' });
    await s.open('2026-09');
    await new PayRecurringExpense(s.recurring, s.transactions, s.ids).execute({ recurringExpenseId: e.id, month: '2026-09', paidDate: '2026-09-20' });
    await s.open('2026-10');
    await s.open('2026-11');
    expect(await s.remove.execute(e.id, '2026-11', 'forward')).toBe('ended');
    expect(await s.names('2026-09')).toEqual(['Internet:pagado']);
    expect(await s.names('2026-10')).toEqual([]);
    expect(await s.names('2026-12')).toEqual([]);
  });

  it('solo este mes: ese mes no aparece ni se vuelve a crear, el siguiente sí', async () => {
    const s = await setup();
    const e = await s.add.execute({ name: 'Gym', amount: 90_000, categoryId: 'cat-servicios', dueDay: 1, startMonth: '2026-10' });
    await s.open('2026-10');
    expect(await s.remove.execute(e.id, '2026-10', 'month')).toBe('skipped');
    expect(await s.names('2026-10')).toEqual([]);
    expect(await s.names('2026-11')).toEqual(['Gym:pendiente']);
  });

  it('una lectura que empezó antes de eliminar no puede volver a crearlo', async () => {
    const s = await setup();
    const e = await s.add.execute({ name: 'Agua', amount: 80_000, categoryId: 'cat-servicios', dueDay: 9, startMonth: '2026-10' });
    // Inicio y las notificaciones leen el mes a la vez que se elimina.
    await Promise.all([s.open('2026-10'), s.remove.execute(e.id, '2026-10', 'forward'), s.open('2026-10')]);
    expect(await s.names('2026-10')).toEqual([]);
    expect(await s.db.all('SELECT * FROM recurring_instances')).toEqual([]);
  });

  it('la migración 9 conserva los pagos de los fijos', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 8));
    await db.run("INSERT INTO recurring_expenses (id, name, amount, category_id, due_day, active, start_month) VALUES ('r', 'Luz', 100, 'cat-servicios', 3, 1, '2026-10')");
    await db.run("INSERT INTO recurring_instances (recurring_expense_id, month, due_date, amount, status) VALUES ('r', '2026-10', '2026-10-03', 100, 'pagado')");
    await runMigrations(db);
    expect(await db.all('SELECT recurring_expense_id, month, status FROM recurring_instances')).toEqual([
      { recurring_expense_id: 'r', month: '2026-10', status: 'pagado' },
    ]);
  });
});

describe('categorías personalizadas (migración 10)', () => {
  it('conserva las categorías del usuario, da ícono a las de la app y no repite nombres', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 9));
    await db.run("INSERT INTO categories (id, name, type) VALUES ('u1', 'luz', 'fijo')");
    await runMigrations(db);
    const cats = await new SqliteCategoryRepository(db).list();
    expect(cats.filter((c) => c.name.toLowerCase() === 'luz')).toEqual([{ id: 'u1', name: 'luz', type: 'fijo', icon: undefined, color: undefined, hidden: false }]);
    expect(cats.find((c) => c.id === 'cat-comida')).toMatchObject({ icon: 'restaurant-outline', hidden: false });
    expect(cats.some((c) => c.id === 'cat-supermercado')).toBe(true);
  });

  it('borrar una categoría pasa todo a la otra sin dejar nada huérfano', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db);
    const cats = new SqliteCategoryRepository(db);
    await cats.save({ id: 'u1', name: 'Mascotas', type: 'variable' });
    await db.run("INSERT INTO transactions (id, date, amount, category_id, note, account_id) VALUES ('t1', '2026-10-01', 500, 'u1', '', 'acc-efectivo')");
    await db.run("INSERT INTO transactions (id, date, amount, category_id, note, account_id) VALUES ('t2', '2026-10-02', 900, 'cat-comida', '', 'acc-efectivo')");
    await db.run("INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES ('t2', 'cat-comida', 600), ('t2', 'u1', 300)");
    await db.run("INSERT INTO recurring_expenses (id, name, amount, category_id, due_day, active, start_month) VALUES ('r', 'Vet', 100, 'u1', 3, 1, '2026-10')");
    await cats.deleteMovingTo('u1', 'cat-comida');
    expect(await db.all("SELECT category_id FROM transactions WHERE id = 't1'")).toEqual([{ category_id: 'cat-comida' }]);
    expect(await db.all('SELECT category_id, amount FROM transaction_splits')).toEqual([{ category_id: 'cat-comida', amount: 900 }]);
    expect(await db.all('SELECT category_id FROM recurring_expenses')).toEqual([{ category_id: 'cat-comida' }]);
    expect(await cats.get('u1')).toBeUndefined();
  });
});

describe('presupuestos con varias categorías (migración 11)', () => {
  it('conserva los presupuestos de antes y guarda las categorías extra', async () => {
    const db = new NodeSqliteDatabase();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 10));
    await db.run("INSERT INTO budgets (id, category_id, month, limit_amount, rollover) VALUES ('b1', 'cat-comida', '2026-10', 500, 1)");
    await runMigrations(db);
    const repo = new SqliteBudgetRepository(db);
    expect(await repo.listByMonth('2026-10')).toEqual([
      { id: 'b1', categoryId: 'cat-comida', extraCategoryIds: [], name: undefined, month: '2026-10', limit: 500, rollover: true },
    ]);
    await repo.save({ id: 'b1', categoryId: 'cat-comida', extraCategoryIds: ['cat-supermercado'], name: 'Comida y súper', month: '2026-10', limit: 900 });
    expect((await repo.listByMonth('2026-10'))[0]).toMatchObject({ extraCategoryIds: ['cat-supermercado'], name: 'Comida y súper', limit: 900 });
    // Si se borra una categoría extra, el presupuesto sigue con las demás.
    await db.run("DELETE FROM categories WHERE id = 'cat-supermercado'");
    expect((await repo.listByMonth('2026-10'))[0].extraCategoryIds).toEqual([]);
  });
});
