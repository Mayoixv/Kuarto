import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { defineCustomElements } from 'jeep-sqlite/loader';
import { SqlDatabase, SqlStatement, SqlValue } from './sql-database';

/** En el navegador el plugin corre sobre sql.js dentro del componente <jeep-sqlite>. */
async function initWeb(sqlite: SQLiteConnection): Promise<void> {
  defineCustomElements(window);
  if (!document.querySelector('jeep-sqlite')) {
    const el = document.createElement('jeep-sqlite');
    el.setAttribute('wasmpath', '/assets');
    // Sin esto, jeep-sqlite solo guarda en IndexedDB al cerrar la conexión y todo se pierde al recargar.
    el.setAttribute('autosave', 'true');
    document.body.appendChild(el);
  }
  await customElements.whenDefined('jeep-sqlite');
  await sqlite.initWebStore();
}

export class CapacitorSqliteDatabase implements SqlDatabase {
  
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly conn: SQLiteDBConnection) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  static async open(name = 'finanzas'): Promise<CapacitorSqliteDatabase> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    if (Capacitor.getPlatform() === 'web') await initWeb(sqlite);

    const { result: exists } = await sqlite.isConnection(name, false);
    const conn = exists
      ? await sqlite.retrieveConnection(name, false)
      : await sqlite.createConnection(name, false, 'no-encryption', 1, false);
    // Si el WebView se recargó, el plugin nativo puede seguir con la base abierta: abrirla otra vez falla.
    if (!(await conn.isDBOpen()).result) await conn.open();
    await conn.execute('PRAGMA foreign_keys = ON;', false);
    return new CapacitorSqliteDatabase(conn);
  }

  async run(sql: string, params: SqlValue[] = []): Promise<void> {
    await this.serial(() => this.conn.run(sql, params));
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const res = await this.serial(() => this.conn.query(sql, params));
    return (res.values ?? []) as T[];
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    // El plugin rechaza una lista vacía ("Must provide a non-empty set"); no hay nada que hacer.
    if (statements.length === 0) return;
    await this.serial(() => this.conn.executeSet(
      statements.map((s) =>
        typeof s === 'string' ? { statement: s, values: [] } : { statement: s.sql, values: s.params },
      ),
      true,
    ));
  }
}
