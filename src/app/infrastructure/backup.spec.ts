import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';
import { AutoBackup, CreateBackup, OpenBackup, RestoreBackup, WipeAllData } from '../application/use-cases/backup';
import { SqliteSettingsRepository } from './repositories/sqlite-repositories';
import { ValidationError } from '../application/errors';
import { MIGRATIONS, runMigrations } from './sqlite/migrations';
import { SqliteBackupStore } from './sqlite/sqlite-backup-store';
import { SqliteTransactionRepository } from './repositories/sqlite-repositories';
import { NodeSqliteDatabase } from './testing/node-sqlite-database';
import { InMemorySettings } from '../application/testing/in-memory';
import { withoutSecrets } from '../ui/backup-files';

// jsdom no trae crypto.subtle; en el navegador y en Android sí existe.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

async function dbWith(amounts: number[]) {
  const db = new NodeSqliteDatabase();
  await runMigrations(db);
  const repo = new SqliteTransactionRepository(db);
  for (const [i, amount] of amounts.entries()) {
    await repo.save({ id: `t${i}`, date: `2026-1${i % 2}-0${i + 1}`, amount, categoryId: 'cat-comida', note: 'nota, con coma' });
  }
  return { db, repo, store: new SqliteBackupStore(db) };
}

describe('respaldo', () => {
  it('cifra, descifra y restaura en otra base exactamente los mismos datos', async () => {
    const a = await dbWith([1250, 99]);
    const file = await new CreateBackup(a.store).execute('secreta1');
    expect(file).not.toContain('nota, con coma');

    const { data, summary } = await new OpenBackup().execute(file, 'secreta1');
    expect(summary).toEqual({ transactions: 2, firstMonth: '2026-10', lastMonth: '2026-11' });

    const b = await dbWith([5]);
    await new RestoreBackup(b.store).execute(data);
    expect(await b.repo.listAll()).toEqual(await a.repo.listAll());
  });

  it('maneja respaldos grandes (más de 1 MB)', async () => {
    const a = await dbWith([100]);
    await a.repo.save({ id: 'big', date: '2026-10-09', amount: 1, categoryId: 'cat-comida', note: 'x'.repeat(1_200_000) });
    const { data } = await new OpenBackup().execute(await new CreateBackup(a.store).execute('secreta1'), 'secreta1');
    expect(data.tables['transactions'].find((t) => t['id'] === 'big')?.['note']).toHaveLength(1_200_000);
  });

  it('rechaza contraseña incorrecta, contraseñas cortas y archivos que no son respaldos', async () => {
    const a = await dbWith([100]);
    const file = await new CreateBackup(a.store).execute('secreta1');
    await expect(new OpenBackup().execute(file, 'otra-clave')).rejects.toThrow('Contraseña incorrecta');
    await expect(new OpenBackup().execute('{"hola":1}', 'x')).rejects.toThrow(ValidationError);
    await expect(new CreateBackup(a.store).execute('123')).rejects.toThrow(ValidationError);
  });

  it('rechaza al instante cabeceras alteradas (iteraciones, salt, iv, datos) sin tocar la base', async () => {
    const a = await dbWith([100]);
    const file = JSON.parse(await new CreateBackup(a.store).execute('secreta1'));
    const bad = [
      { iterations: 1_000_000_000 },
      { iterations: 1 },
      { iterations: 310_000.5 },
      { salt: btoa('corto') },
      { iv: btoa('x'.repeat(16)) },
      { data: '' },
      { data: '¡no es base64!' },
    ];
    const start = Date.now();
    for (const change of bad) {
      await expect(new OpenBackup().execute(JSON.stringify({ ...file, ...change }), 'secreta1')).rejects.toThrow(
        'El archivo no es un respaldo de esta app',
      );
    }
    expect(Date.now() - start).toBeLessThan(1000);
    expect((await new OpenBackup().execute(JSON.stringify(file), 'secreta1')).summary.transactions).toBe(1);
    expect(await a.repo.listAll()).toHaveLength(1);
  });

  it('un respaldo viejo (montos en pesos, esquema 3) se migra a centavos al restaurar', async () => {
    const old = new NodeSqliteDatabase();
    await runMigrations(old, MIGRATIONS.filter((m) => m.version <= 3));
    await old.run(`INSERT INTO transactions (id, date, amount, category_id, note) VALUES ('v', '2026-10-01', 12.5, 'cat-comida', '')`);
    const data = await new SqliteBackupStore(old, MIGRATIONS.filter((m) => m.version <= 3)).dump();
    expect(data.schemaVersion).toBe(3);

    const b = await dbWith([]);
    await b.store.restore(data);
    expect((await b.repo.get('v'))?.amount).toBe(1250);
  });

  it('si el respaldo trae datos inválidos, deja la base como estaba', async () => {
    const b = await dbWith([700]);
    const before = await b.repo.listAll();
    const bad = await b.store.dump();
    bad.tables['transactions'] = [{ id: 'x', date: '2026-10-01', amount: -5, category_id: 'cat-comida', note: '' }];
    await expect(b.store.restore(bad)).rejects.toThrow();
    expect(await b.repo.listAll()).toEqual(before);
  });

  it('ignora tablas y columnas que no existen en el esquema (no se ejecuta nada del archivo)', async () => {
    const b = await dbWith([]);
    const data = await b.store.dump();
    data.tables['transactions'] = [{ id: 'ok', date: '2026-10-01', amount: 100, category_id: 'cat-comida', note: '', 'x); DROP TABLE categories; --': 1 }];
    data.tables['sqlite_master'] = [{ name: 'evil' }];
    await b.store.restore(data);
    expect((await b.repo.listAll()).map((t) => t.id)).toEqual(['ok']);
  });

  it('rechaza respaldos de una versión más nueva de la app', async () => {
    const b = await dbWith([]);
    await expect(b.store.restore({ schemaVersion: 999, tables: {} })).rejects.toThrow('versión más nueva');
  });

  it('borrar todo deja la base como recién instalada y exige escribir BORRAR', async () => {
    const a = await dbWith([1250, 99]);
    await a.db.run("INSERT INTO settings (key, value) VALUES ('pin_hash', 'x')");
    const wipe = new WipeAllData(a.store);
    await expect(wipe.execute('borra')).rejects.toThrow(ValidationError);
    expect(await a.repo.listAll()).toHaveLength(2);

    await wipe.execute(' borrar ');
    expect(await a.repo.listAll()).toEqual([]);
    expect(await a.db.all('SELECT * FROM settings')).toEqual([]);
    const categories = await a.db.all<{ id: string }>('SELECT id FROM categories');
    expect(categories.map((c) => c.id)).toContain('cat-pago-deudas');
    const [{ version }] = await a.db.all<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations');
    expect(version).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
  });

  it('la copia previa solo se hace si hay datos y migraciones pendientes', async () => {
    const fresh = new NodeSqliteDatabase();
    expect(await new SqliteBackupStore(fresh).safetyDump()).toBeNull();

    const old = new NodeSqliteDatabase();
    await runMigrations(old, MIGRATIONS.filter((m) => m.version <= 5));
    await old.run("INSERT INTO transactions (id, date, amount, category_id, note) VALUES ('t1', '2026-10-01', 500, 'cat-comida', '')");
    const copy = await new SqliteBackupStore(old).safetyDump();
    expect(copy?.schemaVersion).toBe(5);
    expect(copy?.tables['transactions']).toHaveLength(1);

    await runMigrations(old);
    expect(await new SqliteBackupStore(old).safetyDump()).toBeNull();
  });

  it('el respaldo automático toca cada 7 días y se abre con su contraseña', async () => {
    const a = await dbWith([1250]);
    const auto = new AutoBackup(new SqliteSettingsRepository(a.db), new CreateBackup(a.store), new InMemorySettings());
    expect(await auto.isDue('2026-10-05')).toBe(false);
    await expect(auto.enable('corta')).rejects.toThrow(ValidationError);
    await auto.enable('semanal1');
    expect(await auto.isDue('2026-10-05')).toBe(true);
    const file = await auto.create();
    await auto.markDone('2026-10-05');
    expect(await auto.isDue('2026-10-11')).toBe(false);
    expect(await auto.isDue('2026-10-12')).toBe(true);
    const { summary } = await new OpenBackup().execute(file, 'semanal1');
    expect(summary.transactions).toBe(1);
    await auto.disable();
    expect(await auto.isDue('2026-10-20')).toBe(false);
  });

  it('el respaldo automático puede ser diario y conservar más o menos archivos', async () => {
    const a = await dbWith([1250]);
    const auto = new AutoBackup(new SqliteSettingsRepository(a.db), new CreateBackup(a.store), new InMemorySettings());
    await auto.enable('diario12');
    expect(await auto.keep()).toBe(4);
    await auto.setFrequency(1);
    await auto.setKeep(8);
    await auto.markDone('2026-10-05');
    expect(await auto.isDue('2026-10-05')).toBe(false);
    expect(await auto.isDue('2026-10-06')).toBe(true);
    expect(await auto.keep()).toBe(8);
    await expect(auto.setKeep(3)).rejects.toThrow(ValidationError);
  });
  it('la contraseña del respaldo automático no queda en la base, ni en los respaldos, ni en la copia previa', async () => {
    const a = await dbWith([1250]);
    const settings = new SqliteSettingsRepository(a.db);
    const secrets = new InMemorySettings();
    const auto = new AutoBackup(settings, new CreateBackup(a.store), secrets);
    await auto.enable('clave-segura');
    await settings.set('pin_hash', 'hash');
    expect(await a.db.all("SELECT value FROM settings WHERE key = 'auto_backup_password'")).toEqual([]);
    expect(JSON.stringify(await a.store.dump())).not.toContain('clave-segura');
    expect(JSON.stringify(withoutSecrets(await a.store.dump()))).not.toContain('pin_hash');
    expect(await auto.isEnabled()).toBe(true);
    const { summary } = await new OpenBackup().execute(await auto.create(), 'clave-segura');
    expect(summary.transactions).toBe(1);
  });

  it('mueve la contraseña vieja al almacenamiento seguro; si falla, la deja donde estaba', async () => {
    const a = await dbWith([1]);
    const settings = new SqliteSettingsRepository(a.db);
    await settings.set('auto_backup_password', 'vieja123');
    const broken = { get: async () => undefined, set: () => Promise.reject(new Error('Keystore')) };
    const failing = new AutoBackup(settings, new CreateBackup(a.store), broken);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await failing.migrateLegacyPassword();
    expect(await settings.get('auto_backup_password')).toBe('vieja123');
    expect(await failing.isEnabled()).toBe(true);

    const secrets = new InMemorySettings();
    const auto = new AutoBackup(settings, new CreateBackup(a.store), secrets);
    await auto.migrateLegacyPassword();
    expect(await settings.get('auto_backup_password')).toBe('');
    expect(await secrets.get('auto_backup_password')).toBe('vieja123');
    expect(await auto.isEnabled()).toBe(true);
  });

  it('un respaldo viejo con la contraseña dentro se restaura con el respaldo automático pidiendo contraseña', async () => {
    const a = await dbWith([1]);
    const data = await a.store.dump();
    data.tables['settings'] = [...data.tables['settings'], { key: 'auto_backup_password', value: 'vieja123' }];
    const b = await dbWith([]);
    await new RestoreBackup(b.store).execute(data);
    const auto = new AutoBackup(new SqliteSettingsRepository(b.db), new CreateBackup(b.store), new InMemorySettings());
    expect(await b.db.all("SELECT value FROM settings WHERE key = 'auto_backup_password'")).toEqual([]);
    expect(await auto.isEnabled()).toBe(false);
    expect(await auto.needsPassword()).toBe(true);
  });
  it('la pantalla de privacidad queda activada en instalaciones nuevas y como estaba en las que ya existían', async () => {
    const fresh = new NodeSqliteDatabase();
    await runMigrations(fresh);
    expect(await new SqliteSettingsRepository(fresh).get('privacy_screen')).toBeUndefined();

    const old = new NodeSqliteDatabase();
    await runMigrations(old, MIGRATIONS.filter((m) => m.version <= 15));
    await old.run("INSERT INTO settings (key, value) VALUES ('currency', 'DOP')");
    await runMigrations(old);
    expect(await new SqliteSettingsRepository(old).get('privacy_screen')).toBe('0');

    const chosen = new NodeSqliteDatabase();
    await runMigrations(chosen, MIGRATIONS.filter((m) => m.version <= 15));
    await chosen.run("INSERT INTO settings (key, value) VALUES ('privacy_screen', '1')");
    await runMigrations(chosen);
    expect(await new SqliteSettingsRepository(chosen).get('privacy_screen')).toBe('1');
  });
});
