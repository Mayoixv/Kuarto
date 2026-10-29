import { inject, Injectable } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { APP_CONTAINER } from '../../app.container';
import { HelpSheetComponent } from '../help/help-sheet.component';
import { isNewer } from '../update/update.service';
import { APP_VERSION } from '../../version';
import { CHANGELOG } from './changelog';
import { t } from '../i18n';

const SEEN_KEY = 'news_seen_version';

/**
 * Lo nuevo desde `since` (sin incluirla) hasta la versión instalada. Sin `since` (quien actualiza desde una versión
 * anterior a las novedades), solo lo de la versión instalada.
 */
export function pointsSince(since: string | null): string[] {
  const from = since ?? CHANGELOG.find((e) => isNewer(APP_VERSION, e.version))?.version ?? APP_VERSION;
  return CHANGELOG.filter((e) => !isNewer(e.version, APP_VERSION) && isNewer(e.version, from)).flatMap((e) => e.points);
}

/** Muestra las novedades una vez después de actualizar, y a pedido desde Ajustes. */
@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly container = inject(APP_CONTAINER);
  private readonly modals = inject(ModalController);

  /**
   * Al abrir la app: si se actualizó desde la última vez, muestra lo nuevo y devuelve true.
   * En una instalación nueva no muestra nada.
   */
  async showIfUpdated(): Promise<boolean> {
    const seen = (await this.container.settings.get(SEEN_KEY)) || null;
    if (seen === APP_VERSION) return false;
    await this.container.settings.set(SEEN_KEY, APP_VERSION);
    // Quien empieza de cero ve la bienvenida; las novedades son para quien ya usaba la app.
    if (await this.container.onboarding.needed()) return false;
    const points = pointsSince(seen);
    if (points.length) await this.open(points);
    return true;
  }

  /** Ajustes › Novedades: lo de la versión instalada. */
  openLatest() {
    return this.open(CHANGELOG.find((e) => e.version === APP_VERSION)?.points ?? [t('news.fallback')]);
  }

  private async open(points: string[]) {
    const sheet = await this.modals.create({
      component: HelpSheetComponent,
      componentProps: { news: { title: t('news.title', { version: APP_VERSION }), points } },
      cssClass: 'select-modal',
    });
    await sheet.present();
    // Hasta cerrarla: lo que viene después al abrir la app (pedir el nombre) no debe taparla.
    await sheet.onDidDismiss();
  }
}
