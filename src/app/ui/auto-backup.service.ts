import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { APP_CONTAINER } from '../app.container';
import { saveAutoBackup } from './backup-files';
import { CloudBackupService } from './cloud/cloud-backup.service';
import { todayIso } from './format';
import { AutoBackupFrequency } from '../application/use-cases/backup';

/** Respaldo automático diario o semanal: al abrir la app, si toca, lo crea y lo guarda en Documentos/Kuarto. */
@Injectable({ providedIn: 'root' })
export class AutoBackupService {
  private readonly container = inject(APP_CONTAINER);
  private readonly cloud = inject(CloudBackupService);

  readonly available = Capacitor.isNativePlatform();
  readonly enabled = signal(false);
  /** Venía activado en un respaldo de otro teléfono: hay que volver a poner la contraseña. */
  readonly needsPassword = signal(false);
  /** Fecha ISO del último respaldo automático guardado. */
  readonly lastRun = signal<string | null>(null);
  readonly lastError = signal(false);
  readonly frequency = signal<AutoBackupFrequency>(7);
  readonly keep = signal(4);

  constructor() {
    if (!this.available) return;
    // Un poco después de abrir, para no retrasar la primera pantalla (cifrar tarda un momento).
    setTimeout(() => this.runIfDue().catch((e) => console.error(e)), 3000);
  }

  async refresh(): Promise<void> {
    this.enabled.set(await this.container.autoBackup.isEnabled());
    this.needsPassword.set(await this.container.autoBackup.needsPassword());
    this.lastRun.set(await this.container.autoBackup.lastRun());
    this.frequency.set(await this.container.autoBackup.frequency());
    this.keep.set(await this.container.autoBackup.keep());
  }

  async setFrequency(days: AutoBackupFrequency): Promise<void> {
    await this.container.autoBackup.setFrequency(days);
    await this.runIfDue();
  }

  /** Al bajar cuántos se conservan, los sobrantes se borran con el próximo respaldo. */
  async setKeep(count: number): Promise<void> {
    await this.container.autoBackup.setKeep(count);
    await this.refresh();
  }

  async runIfDue(): Promise<void> {
    await this.refresh();
    if (await this.container.autoBackup.isDue(todayIso())) await this.runNow();
  }

  /** Hace el respaldo ya (al activarlo o si toca). Devuelve false si no se pudo guardar. */
  async runNow(): Promise<boolean> {
    try {
      const file = await this.container.autoBackup.create();
      await saveAutoBackup(file, await this.container.autoBackup.keep());
      await this.container.autoBackup.markDone(todayIso());
      // Con cuenta conectada, el mismo archivo cifrado va también a la nube. Si falla (sin internet), el respaldo
      // del teléfono ya quedó y la nube se pone al día en el próximo respaldo o con "Subir ahora".
      if (this.cloud.email()) await this.cloud.upload(file).catch((e) => console.error(e));
      this.lastError.set(false);
      return true;
    } catch (error) {
      // Si falla (por ejemplo, sin espacio), se vuelve a intentar la próxima vez que se abra la app.
      console.error(error);
      this.lastError.set(true);
      return false;
    } finally {
      await this.refresh();
    }
  }

  async enable(password: string): Promise<boolean> {
    await this.container.autoBackup.enable(password);
    return this.runNow();
  }

  async disable(): Promise<void> {
    await this.container.autoBackup.disable();
    await this.refresh();
  }
}
