import { daysBetween, monthOf } from '../../domain/month';
import { decryptText, encryptText } from '../backup-crypto';
import { ValidationError } from '../errors';
import { BackupData, IBackupStore, ISettingsRepository } from '../ports/repositories';

const MIN_PASSWORD = 6;

export interface BackupSummary {
  transactions: number;
  /** Primer y último mes con movimientos; null si no hay. */
  firstMonth: string | null;
  lastMonth: string | null;
}

export class CreateBackup {
  constructor(private readonly store: IBackupStore) {}

  async execute(password: string): Promise<string> {
    if (password.length < MIN_PASSWORD) {
      throw new ValidationError('passwordLength', { min: MIN_PASSWORD });
    }
    return encryptText(JSON.stringify(await this.store.dump()), password);
  }
}

/** Descifra y valida un respaldo sin tocar los datos actuales, para mostrar qué contiene antes de restaurar. */
export class OpenBackup {
  async execute(fileText: string, password: string): Promise<{ data: BackupData; summary: BackupSummary }> {
    const data = JSON.parse(await decryptText(fileText, password)) as BackupData;
    if (!Number.isInteger(data?.schemaVersion) || typeof data.tables !== 'object') {
      throw new ValidationError('backupIncomplete');
    }
    const months = (data.tables['transactions'] ?? [])
      .map((t) => monthOf(String(t['date'])))
      .sort();
    return {
      data,
      summary: {
        transactions: months.length,
        firstMonth: months[0] ?? null,
        lastMonth: months[months.length - 1] ?? null,
      },
    };
  }
}

export class RestoreBackup {
  constructor(private readonly store: IBackupStore) {}

  /** Reemplaza todos los datos actuales por los del respaldo. Si algo falla, quedan los de antes. */
  execute(data: BackupData): Promise<void> {
    return this.store.restore(data);
  }

  /** Los datos de ahora, para guardar una copia antes de reemplazarlos. */
  current(): Promise<BackupData> {
    return this.store.dump();
  }
}

/** Palabra que hay que escribir para confirmar el borrado total. */
export const WIPE_CONFIRMATION = 'BORRAR';

export class WipeAllData {
  constructor(private readonly store: IBackupStore) {}

  /** Borra todos los datos y ajustes (también el PIN). Exige escribir BORRAR para que no pase por un toque. */
  async execute(confirmation: string): Promise<void> {
    if (confirmation.trim().toUpperCase() !== WIPE_CONFIRMATION) {
      throw new ValidationError('wipeConfirm', { word: WIPE_CONFIRMATION });
    }
    return this.store.wipe();
  }
}

/** Cada cuántos días se hace el respaldo automático: diario o semanal (semanal por defecto). */
export const AUTO_BACKUP_FREQUENCIES = [1, 7] as const;
export type AutoBackupFrequency = (typeof AUTO_BACKUP_FREQUENCIES)[number];
/** Cuántos respaldos automáticos se conservan en el teléfono; los más viejos se borran. */
export const AUTO_BACKUP_KEEP_OPTIONS = [2, 4, 8, 12] as const;
const DEFAULT_KEEP = 4;

/** Claves del respaldo automático: la contraseña va en el almacenamiento seguro; en `settings` solo la bandera. */
const PASSWORD_KEY = 'auto_backup_password';
const ENABLED_KEY = 'auto_backup_enabled';

/**
 * Respaldo automático, cifrado con una contraseña que se elige una vez. La contraseña se guarda en `secrets`
 * (el Keystore de Android), nunca en la base: la base y sus copias no la llevan.
 * El archivo lo guarda la interfaz (en Documentos del teléfono); aquí solo se decide cuándo y se genera.
 */
export class AutoBackup {
  constructor(
    private readonly settings: ISettingsRepository,
    private readonly backup: CreateBackup,
    private readonly secrets: ISettingsRepository,
  ) {}

  /**
   * Hasta la 1.0.14 la contraseña estaba en `settings`: se mueve al almacenamiento seguro y se borra de la base.
   * Si el almacenamiento seguro falla, se deja donde estaba para no apagar el respaldo.
   */
  async migrateLegacyPassword(): Promise<void> {
    const legacy = await this.settings.get(PASSWORD_KEY);
    if (!legacy) return;
    await this.settings.set(ENABLED_KEY, '1');
    try {
      await this.secrets.set(PASSWORD_KEY, legacy);
      if ((await this.secrets.get(PASSWORD_KEY)) !== legacy) throw new Error('El almacenamiento seguro no devolvió la contraseña');
      await this.settings.set(PASSWORD_KEY, '');
    } catch (error) {
      console.error('No se pudo mover la contraseña del respaldo automático', error);
    }
  }

  private async password(): Promise<string | null> {
    return (await this.secrets.get(PASSWORD_KEY)) || (await this.settings.get(PASSWORD_KEY)) || null;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.settings.get(ENABLED_KEY)) === '1' && !!(await this.password());
  }

  /** Activado pero sin contraseña en este teléfono: pasa al restaurar un respaldo hecho en otro. */
  async needsPassword(): Promise<boolean> {
    return (await this.settings.get(ENABLED_KEY)) === '1' && !(await this.password());
  }

  async lastRun(): Promise<string | null> {
    return (await this.settings.get('auto_backup_last')) || null;
  }

  async enable(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD) throw new ValidationError('passwordLength', { min: MIN_PASSWORD });
    await this.secrets.set(PASSWORD_KEY, password);
    await this.settings.set(ENABLED_KEY, '1');
    await this.settings.set('auto_backup_last', '');
  }

  async disable(): Promise<void> {
    await this.settings.set(ENABLED_KEY, '0');
    await this.secrets.set(PASSWORD_KEY, '');
    await this.settings.set(PASSWORD_KEY, '');
  }

  async frequency(): Promise<AutoBackupFrequency> {
    return (await this.settings.get('auto_backup_days')) === '1' ? 1 : 7;
  }

  async setFrequency(days: AutoBackupFrequency): Promise<void> {
    if (!AUTO_BACKUP_FREQUENCIES.includes(days)) throw new ValidationError('frequency');
    await this.settings.set('auto_backup_days', String(days));
  }

  async keep(): Promise<number> {
    const saved = Number(await this.settings.get('auto_backup_keep'));
    return (AUTO_BACKUP_KEEP_OPTIONS as readonly number[]).includes(saved) ? saved : DEFAULT_KEEP;
  }

  async setKeep(count: number): Promise<void> {
    if (!(AUTO_BACKUP_KEEP_OPTIONS as readonly number[]).includes(count)) throw new ValidationError('backupKeep');
    await this.settings.set('auto_backup_keep', String(count));
  }

  /** Si toca hacer el respaldo hoy: activado y sin respaldo en el último día o semana, según la frecuencia. */
  async isDue(today: string): Promise<boolean> {
    if (!(await this.isEnabled())) return false;
    const last = await this.lastRun();
    return !last || daysBetween(last, today) >= (await this.frequency());
  }

  /** Genera el archivo cifrado. Se marca como hecho solo cuando la interfaz confirma que lo guardó. */
  async create(): Promise<string> {
    const password = await this.password();
    if (!password) throw new ValidationError('autoBackupOff');
    return this.backup.execute(password);
  }

  markDone(today: string): Promise<void> {
    return this.settings.set('auto_backup_last', today);
  }
}
