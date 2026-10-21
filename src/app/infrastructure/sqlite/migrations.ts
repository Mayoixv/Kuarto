import { SqlDatabase } from './sql-database';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/** Nunca se edita una migración ya publicada: los cambios van en una versión nueva. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'esquema inicial',
    statements: [
      `CREATE TABLE categories (
         id   TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         type TEXT NOT NULL CHECK (type IN ('ingreso', 'fijo', 'variable'))
       )`,
      `CREATE TABLE transactions (
         id          TEXT PRIMARY KEY,
         date        TEXT NOT NULL,
         amount      REAL NOT NULL CHECK (amount > 0),
         category_id TEXT NOT NULL REFERENCES categories(id),
         note        TEXT NOT NULL DEFAULT ''
       )`,
      `CREATE INDEX idx_transactions_date ON transactions(date)`,
      `CREATE TABLE recurring_expenses (
         id          TEXT PRIMARY KEY,
         name        TEXT NOT NULL,
         amount      REAL NOT NULL CHECK (amount > 0),
         category_id TEXT NOT NULL REFERENCES categories(id),
         due_day     INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
         active      INTEGER NOT NULL DEFAULT 1
       )`,
      `CREATE TABLE recurring_instances (
         recurring_expense_id TEXT NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
         month                TEXT NOT NULL,
         due_date             TEXT NOT NULL,
         amount               REAL NOT NULL,
         status               TEXT NOT NULL CHECK (status IN ('pagado', 'pendiente')),
         transaction_id       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
         PRIMARY KEY (recurring_expense_id, month)
       )`,
      `CREATE TABLE savings_goals (
         id            TEXT PRIMARY KEY,
         name          TEXT NOT NULL,
         target_amount REAL NOT NULL CHECK (target_amount > 0)
       )`,
      `CREATE TABLE savings_contributions (
         id      TEXT PRIMARY KEY,
         goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
         date    TEXT NOT NULL,
         amount  REAL NOT NULL CHECK (amount > 0)
       )`,
      `CREATE INDEX idx_contributions_date ON savings_contributions(date)`,
      `CREATE TABLE budgets (
         id           TEXT PRIMARY KEY,
         category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
         month        TEXT NOT NULL,
         limit_amount REAL NOT NULL CHECK (limit_amount > 0),
         UNIQUE (category_id, month)
       )`,
    ],
  },
  {
    version: 2,
    name: 'categorías iniciales',
    statements: [
      `INSERT INTO categories (id, name, type) VALUES
         ('cat-salario', 'Salario', 'ingreso'),
         ('cat-otros-ingresos', 'Otros ingresos', 'ingreso'),
         ('cat-alquiler', 'Alquiler', 'fijo'),
         ('cat-servicios', 'Servicios', 'fijo'),
         ('cat-suscripciones', 'Suscripciones', 'fijo'),
         ('cat-comida', 'Comida', 'variable'),
         ('cat-transporte', 'Transporte', 'variable'),
         ('cat-salud', 'Salud', 'variable'),
         ('cat-ocio', 'Ocio', 'variable'),
         ('cat-otros-gastos', 'Otros gastos', 'variable')`,
    ],
  },
  {
    version: 3,
    name: 'mes de inicio de gastos fijos',
    statements: [
      `ALTER TABLE recurring_expenses ADD COLUMN start_month TEXT NOT NULL DEFAULT '0000-01'`,
    ],
  },
  {
    version: 4,
    name: 'montos en centavos',
    // Se pasan a enteros para que sumar y comparar montos sea exacto.
    statements: [
      `UPDATE transactions SET amount = CAST(ROUND(amount * 100) AS INTEGER)`,
      `UPDATE recurring_expenses SET amount = CAST(ROUND(amount * 100) AS INTEGER)`,
      `UPDATE recurring_instances SET amount = CAST(ROUND(amount * 100) AS INTEGER)`,
      `UPDATE savings_goals SET target_amount = CAST(ROUND(target_amount * 100) AS INTEGER)`,
      `UPDATE savings_contributions SET amount = CAST(ROUND(amount * 100) AS INTEGER)`,
      `UPDATE budgets SET limit_amount = CAST(ROUND(limit_amount * 100) AS INTEGER)`,
    ],
  },
  {
    version: 5,
    name: 'ajustes',
    statements: [
      `CREATE TABLE settings (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    ],
  },
  {
    version: 6,
    name: 'etiquetas, divisiones y fotos de recibos',
    statements: [
      `ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''`,
      `CREATE TABLE transaction_splits (
         transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
         category_id    TEXT NOT NULL REFERENCES categories(id),
         amount         INTEGER NOT NULL CHECK (amount > 0),
         PRIMARY KEY (transaction_id, category_id)
       )`,
      `CREATE TABLE attachments (
         id             TEXT PRIMARY KEY,
         transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
         data           TEXT NOT NULL,
         created_at     TEXT NOT NULL
       )`,
      `CREATE INDEX idx_attachments_transaction ON attachments(transaction_id)`,
    ],
  },
  {
    version: 7,
    name: 'frecuencia y pausa de fijos, metas con fecha, retiros, rollover y deudas',
    statements: [
      `ALTER TABLE recurring_expenses ADD COLUMN frequency INTEGER NOT NULL DEFAULT 1 CHECK (frequency IN (1, 3, 6, 12))`,
      `ALTER TABLE recurring_expenses ADD COLUMN paused_until TEXT`,
      `ALTER TABLE savings_goals ADD COLUMN target_date TEXT`,
      `ALTER TABLE savings_contributions ADD COLUMN withdrawal INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE budgets ADD COLUMN rollover INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE debts (
         id          TEXT PRIMARY KEY,
         name        TEXT NOT NULL,
         direction   TEXT NOT NULL CHECK (direction IN ('debo', 'me_deben')),
         principal   INTEGER NOT NULL CHECK (principal > 0),
         annual_rate REAL NOT NULL DEFAULT 0 CHECK (annual_rate BETWEEN 0 AND 200),
         term_months INTEGER CHECK (term_months BETWEEN 1 AND 600),
         start_date  TEXT NOT NULL
       )`,
      `CREATE TABLE debt_payments (
         id             TEXT PRIMARY KEY,
         debt_id        TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
         date           TEXT NOT NULL,
         amount         INTEGER NOT NULL CHECK (amount > 0),
         principal      INTEGER NOT NULL,
         interest       INTEGER NOT NULL,
         transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL
       )`,
      `INSERT OR IGNORE INTO categories (id, name, type) VALUES ('cat-pago-deudas', 'Pago de deudas', 'fijo')`,
    ],
  },
  {
    version: 8,
    name: 'cuentas y transferencias',
    statements: [
      `CREATE TABLE accounts (
         id              TEXT PRIMARY KEY,
         name            TEXT NOT NULL,
         type            TEXT NOT NULL CHECK (type IN ('efectivo', 'banco', 'ahorro', 'tarjeta', 'inversion')),
         initial_balance INTEGER NOT NULL DEFAULT 0,
         credit_limit    INTEGER CHECK (credit_limit > 0),
         cut_day         INTEGER CHECK (cut_day BETWEEN 1 AND 31),
         due_day         INTEGER CHECK (due_day BETWEEN 1 AND 31),
         archived        INTEGER NOT NULL DEFAULT 0
       )`,
      `INSERT OR IGNORE INTO accounts (id, name, type) VALUES ('acc-efectivo', 'Efectivo', 'efectivo')`,
      // SQLite no deja agregar una columna con REFERENCES y un valor por defecto no nulo: la cuenta la valida la app.
      `ALTER TABLE transactions ADD COLUMN account_id TEXT NOT NULL DEFAULT 'acc-efectivo'`,
      `CREATE INDEX idx_transactions_account ON transactions(account_id)`,
      `ALTER TABLE recurring_expenses ADD COLUMN account_id TEXT`,
      `CREATE TABLE transfers (
         id           TEXT PRIMARY KEY,
         date         TEXT NOT NULL,
         amount       INTEGER NOT NULL CHECK (amount > 0),
         from_account TEXT NOT NULL REFERENCES accounts(id),
         to_account   TEXT NOT NULL REFERENCES accounts(id),
         note         TEXT NOT NULL DEFAULT '',
         CHECK (from_account <> to_account)
       )`,
      `CREATE INDEX idx_transfers_date ON transfers(date)`,
    ],
  },
  {
    version: 9,
    name: 'fijos omitidos un mes',
    statements: [
      `CREATE TABLE recurring_instances_new (
         recurring_expense_id TEXT NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
         month                TEXT NOT NULL,
         due_date             TEXT NOT NULL,
         amount               REAL NOT NULL,
         status               TEXT NOT NULL CHECK (status IN ('pagado', 'pendiente', 'omitido')),
         transaction_id       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
         PRIMARY KEY (recurring_expense_id, month)
       )`,
      `INSERT INTO recurring_instances_new (recurring_expense_id, month, due_date, amount, status, transaction_id)
       SELECT recurring_expense_id, month, due_date, amount, status, transaction_id FROM recurring_instances`,
      `DROP TABLE recurring_instances`,
      `ALTER TABLE recurring_instances_new RENAME TO recurring_instances`,
    ],
  },
  {
    version: 10,
    name: 'categorías con ícono, color y ocultas; más categorías comunes',
    statements: [
      `ALTER TABLE categories ADD COLUMN icon TEXT`,
      `ALTER TABLE categories ADD COLUMN color TEXT`,
      `ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`,
      `UPDATE categories SET icon = 'cash-outline', color = '#0f8a5f' WHERE id = 'cat-salario'`,
      `UPDATE categories SET icon = 'wallet-outline', color = '#0e7490' WHERE id = 'cat-otros-ingresos'`,
      `UPDATE categories SET icon = 'home-outline', color = '#6639ec' WHERE id = 'cat-alquiler'`,
      `UPDATE categories SET icon = 'construct-outline', color = '#475569' WHERE id = 'cat-servicios'`,
      `UPDATE categories SET icon = 'play-circle-outline', color = '#be185d' WHERE id = 'cat-suscripciones'`,
      `UPDATE categories SET icon = 'card-outline', color = '#b91c1c' WHERE id = 'cat-pago-deudas'`,
      `UPDATE categories SET icon = 'restaurant-outline', color = '#c2410c' WHERE id = 'cat-comida'`,
      `UPDATE categories SET icon = 'bus-outline', color = '#2563eb' WHERE id = 'cat-transporte'`,
      `UPDATE categories SET icon = 'medkit-outline', color = '#be185d' WHERE id = 'cat-salud'`,
      `UPDATE categories SET icon = 'game-controller-outline', color = '#6639ec' WHERE id = 'cat-ocio'`,
      `UPDATE categories SET icon = 'pricetag-outline', color = '#475569' WHERE id = 'cat-otros-gastos'`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-luz', 'Luz', 'fijo', 'flash-outline', '#a16207'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-luz' OR lower(name) = lower('Luz'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-agua', 'Agua', 'fijo', 'water-outline', '#2563eb'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-agua' OR lower(name) = lower('Agua'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-internet', 'Internet y cable', 'fijo', 'wifi-outline', '#0e7490'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-internet' OR lower(name) = lower('Internet y cable'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-telefono', 'Teléfono', 'fijo', 'phone-portrait-outline', '#6639ec'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-telefono' OR lower(name) = lower('Teléfono'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-seguros', 'Seguros', 'fijo', 'shield-checkmark-outline', '#0f8a5f'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-seguros' OR lower(name) = lower('Seguros'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-educacion', 'Educación', 'fijo', 'school-outline', '#c2410c'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-educacion' OR lower(name) = lower('Educación'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-supermercado', 'Supermercado', 'variable', 'cart-outline', '#0f8a5f'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-supermercado' OR lower(name) = lower('Supermercado'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-gasolina', 'Gasolina', 'variable', 'car-outline', '#a16207'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-gasolina' OR lower(name) = lower('Gasolina'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-ropa', 'Ropa', 'variable', 'shirt-outline', '#be185d'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-ropa' OR lower(name) = lower('Ropa'))`,
      `INSERT INTO categories (id, name, type, icon, color)
       SELECT 'cat-hogar', 'Hogar', 'variable', 'bed-outline', '#0e7490'
       WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = 'cat-hogar' OR lower(name) = lower('Hogar'))`,
    ],
  },
  {
    version: 11,
    name: 'presupuestos con varias categorías',
    statements: [
      `ALTER TABLE budgets ADD COLUMN name TEXT`,
      // Solo las categorías extra; la principal sigue en budgets.category_id, así los presupuestos de antes no cambian.
      `CREATE TABLE budget_categories (
         budget_id   TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
         category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
         PRIMARY KEY (budget_id, category_id)
       )`,
    ],
  },
  {
    version: 12,
    name: 'compras importadas de las notificaciones del banco',
    statements: [
      `ALTER TABLE accounts ADD COLUMN card_last4 TEXT`,
      `CREATE TABLE bank_imports (
         id             TEXT PRIMARY KEY,
         key            TEXT NOT NULL UNIQUE,
         bank           TEXT NOT NULL,
         kind           TEXT NOT NULL CHECK (kind IN ('compra', 'reverso')),
         amount         INTEGER NOT NULL CHECK (amount > 0),
         currency       TEXT NOT NULL,
         merchant       TEXT NOT NULL,
         date           TEXT NOT NULL,
         last4          TEXT NOT NULL,
         status         TEXT NOT NULL CHECK (status IN ('pendiente', 'confirmado', 'descartado')),
         received_at    TEXT NOT NULL,
         transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
         category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL
       )`,
      `CREATE INDEX idx_bank_imports_status ON bank_imports(status)`,
    ],
  },
  {
    version: 13,
    name: 'aportes a metas desde una cuenta',
    // Los aportes que ya existen quedan sin cuenta: así ningún saldo cambia al actualizar.
    statements: [`ALTER TABLE savings_contributions ADD COLUMN account_id TEXT`],
  },
  {
    version: 14,
    name: 'cuota de una deuda como gasto fijo',
    // Si se borra la deuda, el fijo queda como un gasto fijo normal.
    statements: [`ALTER TABLE recurring_expenses ADD COLUMN debt_id TEXT REFERENCES debts(id) ON DELETE SET NULL`],
  },
  {
    version: 15,
    name: 'cuenta interna para los ajustes de saldo',
    // Los ajustes de antes cambiaron el saldo inicial y se quedan así: solo los nuevos dejan movimiento.
    statements: [`INSERT OR IGNORE INTO accounts (id, name, type, archived) VALUES ('acc-ajuste', 'Ajuste', 'banco', 1)`],
  },
  {
    version: 16,
    name: 'pantalla de privacidad activada en instalaciones nuevas',
    // Quien ya usaba la app sin tocar el ajuste la sigue teniendo apagada; en una instalación nueva no hay filas aún.
    statements: [
      `INSERT OR IGNORE INTO settings (key, value) SELECT 'privacy_screen', '0'
        WHERE EXISTS (SELECT 1 FROM settings) OR EXISTS (SELECT 1 FROM transactions)`,
    ],
  },
];

/** Aplica las migraciones pendientes en orden y devuelve las versiones aplicadas. */
export async function runMigrations(
  db: SqlDatabase,
  migrations: Migration[] = MIGRATIONS,
): Promise<number[]> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const done = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(done.map((r) => r.version));
  const ran: number[] = [];

  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    await db.batch([
      ...m.statements,
      `INSERT INTO schema_migrations (version, name, applied_at)
       VALUES (${m.version}, '${m.name.replace(/'/g, "''")}', '${new Date().toISOString()}')`,
    ]);
    ran.push(m.version);
  }
  return ran;
}
