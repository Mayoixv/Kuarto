import { inject, Injectable, signal } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { APP_CONTAINER } from '../../app.container';
import { APP_VERSION } from '../../version';
import { todayIso } from '../format';
import { t } from '../i18n';

/** Plugin nativo propio (android/.../AppUpdaterPlugin.java). */
interface AppUpdaterPlugin {
  info(): Promise<{ canUpdate: boolean }>;
  downloadAndInstall(options: { url: string }): Promise<{ needsPermission: boolean }>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

/** Releases del repositorio: cada versión lleva su APK adjunto (Kuarto-1.0.4.apk). */
const LATEST_URL = 'https://api.github.com/repos/Mayoixv/App-Finanzas/releases/latest';
const CHECKED_KEY = 'update_checked_on';

export interface AppRelease {
  version: string;
  url: string;
}

/** "1.0.5" de "Kuarto-1.0.5.apk" o de "v1.0.5"; null si no trae un número de versión. */
export function releaseVersion(text: string): string | null {
  return /\d+(?:\.\d+)+/.exec(text)?.[0] ?? null;
}

/** La descarga solo puede venir de github.com por https; el plugin nativo vuelve a comprobarlo en cada redirección. */
export function fromGitHub(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com';
  } catch {
    return false;
  }
}

/** true si `a` (por ejemplo "1.0.10") es más nueva que `b` ("1.0.9"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Busca una versión nueva al abrir la app (una vez al día) o desde Ajustes, y la instala como Mihon:
 * descarga el APK y Android muestra "Instalar". Solo lee la lista de versiones; no envía datos.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly container = inject(APP_CONTAINER);
  private readonly alerts = inject(AlertController);

  readonly status = signal('');
  readonly busy = signal(false);
  /** Solo en el APK firmado del teléfono; la versión de depuración y el navegador no se actualizan así. */
  readonly supported = signal(false);

  constructor() {
    if (Capacitor.getPlatform() !== 'android') return;
    AppUpdater.info()
      .then(async ({ canUpdate }) => {
        this.supported.set(canUpdate);
        if (canUpdate && (await this.container.settings.get(CHECKED_KEY)) !== todayIso()) await this.check(false);
      })
      .catch(console.error);
  }

  /** `manual`: desde Ajustes, dice también cuando no hay nada nuevo o no hay conexión. */
  async check(manual = true) {
    if (this.busy()) return;
    this.busy.set(true);
    if (manual) this.status.set(t('update.searching'));
    try {
      const release = await this.latest();
      await this.container.settings.set(CHECKED_KEY, todayIso());
      if (!release || !isNewer(release.version, APP_VERSION)) {
        if (manual) this.status.set(t('update.latest', { version: APP_VERSION }));
        return;
      }
      this.status.set(t('update.available', { version: release.version }));
      await this.offer(release);
    } catch (e) {
      console.error(e);
      if (manual) this.status.set(t('update.failed'));
    } finally {
      this.busy.set(false);
    }
  }

  private async latest(): Promise<AppRelease | null> {
    const res = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    const data = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const apk = data.assets.find((a) => a.name.endsWith('.apk'));
    // El número sale del nombre del APK (Kuarto-1.0.5.apk) o, si no lo trae, de la etiqueta (v1.0.5).
    const version = releaseVersion(apk?.name ?? '') ?? releaseVersion(data.tag_name);
    return apk && version && fromGitHub(apk.browser_download_url) ? { version, url: apk.browser_download_url } : null;
  }

  private async offer(release: AppRelease) {
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('update.newTitle'),
      message: t('update.newMsg', { version: release.version }),
      buttons: [
        { text: t('update.later'), role: 'cancel' },
        { text: t('update.update'), role: 'confirm' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    this.status.set(t('update.downloading'));
    const { needsPermission } = await AppUpdater.downloadAndInstall({ url: release.url });
    this.status.set(
      needsPermission
        ? t('update.permission')
        : t('update.downloaded', { version: release.version }),
    );
  }
}
