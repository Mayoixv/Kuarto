import { ValidationError } from '../../application/errors';
import { BackupData, IBackupStore } from '../../application/ports/repositories';
import { Migration, MIGRATIONS, runMigrations } from './migrations';
import { SqlDatabase, SqlStatement } from './sql-database';

/** Tablas con datos del usuario, de padres a hijos (orden válido para insertar con claves foráneas). */
const TABLES = [
  'categories',
  'accounts',
  'transactions',
  'transaction_splits',
  'bank_imports',
  'attachments',
  'recurring_expenses',
  'recurring_instances',
  'savings_goals',
  'savings_contributions',
  'budgets',
  'budget_categories',
  'settings',
  'debts',
  'debt_payments',
  'transfers',
];

type Row = Record<string, string | number | null>;

/** La contraseña del respaldo automático no viaja en respaldos ni copias (va en el almacenamiento seguro). */
const SECRET_SETTING = 'auto_backup_password';

/**
 * Respaldos de hasta la 1.0.14 traen la contraseña en `settings`: se descarta y el respaldo automático queda
 * "activado sin contraseña", para que la app la pida en vez de reactivarlo solo en otro teléfono.
 */
function withoutSecret(data: BackupData): BackupData {
  const rows = data.tables['settings'];
  if (!rows) return data;
  const hadPassword = rows.some((r) => r['key'] === SECRET_SETTING && r['value']);
  const settings = rows.filter((r) => r['key'] !== SECRET_SETTING);
  if (hadPassword && !settings.some((r) => r['key'] === 'auto_backup_enabled')) {
    settings.push({ key: 'auto_backup_enabled', value: '1' });
  }
  return { ...data, tables: { ...data.tables, settings } };
}

export class SqliteBackupStore implements IBackupStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly migrations: Migration[] = MIGRATIONS,
  ) {}

  async dump(): Promise<BackupData> {
    const [{ version }] = await this.db.all<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    );
    const tables: BackupData['tables'] = {};
    for (const table of await this.existingTables()) {
      const rows = await this.db.all<Row>(`SELECT * FROM ${table}`);
      tables[table] = table === 'settings' ? rows.filter((r) => r['key'] !== SECRET_SETTING) : rows;
    }
    return { schemaVersion: version, tables };
  }

  async restore(data: BackupData): Promise<void> {
    const latest = Math.max(...this.migrations.map((m) => m.version));
    if (data.schemaVersion > latest) {
      throw new ValidationError('backupNewer');
    }
    const before = await this.dump();
    try {
      await this.replaceWith(withoutSecret(data));
    } catch (error) {
      // Si el respaldo no entra (datos inválidos), se vuelve a lo que había: nunca queda la base a medias.
      await this.replaceWith(before);
      throw error;
    }
  }

  /**
   * Copia de los datos antes de actualizar la base: solo si ya hay datos y quedan migraciones por aplicar.
   * Devuelve null si no hace falta (instalación nueva o base al día).
   */
  async safetyDump(): Promise<BackupData | null> {
    const tables = await this.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    );
    if (tables.length === 0) return null;
    const done = new Set(
      (await this.db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version),
    );
    if (done.size === 0 || this.migrations.every((m) => done.has(m.version))) return null;
    return this.dump();
  }

  async wipe(): Promise<void> {
    // Un respaldo vacío de versión 0: se borra todo y se aplican todas las migraciones desde cero.
    await this.replaceWith({ schemaVersion: 0, tables: {} });
  }

  /**
   * Recrea el esquema hasta la versión del respaldo, carga sus filas y aplica las migraciones que falten.
   * Así un respaldo viejo pasa por las mismas conversiones que una base vieja (por ejemplo, a centavos).
   */
  private async replaceWith(data: BackupData) {
    const drop = [...TABLES].reverse().map((t) => `DROP TABLE IF EXISTS ${t}`);
    await this.db.batch([...drop, 'DROP TABLE IF EXISTS schema_migrations']);
    await runMigrations(this.db, this.migrations.filter((m) => m.version <= data.schemaVersion));

    const existing = await this.existingTables();
    const statements: SqlStatement[] = [...existing].reverse().map((t) => `DELETE FROM ${t}`);
    for (const table of existing) {
      // Los nombres de tabla y columna salen del esquema real, nunca del archivo: el archivo solo aporta valores.
      const columns = new Set(
        (await this.db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name),
      );
      for (const row of data.tables[table] ?? []) {
        const cols = Object.keys(row).filter((c) => columns.has(c));
        if (cols.length === 0) continue;
        statements.push({
          sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          params: cols.map((c) => row[c]),
        });
      }
    }
    await this.db.batch(statements);
    await runMigrations(this.db, this.migrations);
  }

  private async existingTables(): Promise<string[]> {
    const rows = await this.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = new Set(rows.map((r) => r.name));
    return TABLES.filter((t) => names.has(t));
  }
}
