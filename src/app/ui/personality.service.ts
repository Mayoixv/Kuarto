import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ToastController } from '@ionic/angular';
import { APP_CONTAINER } from '../app.container';
import { Personality, pickIndex } from '../domain/personality';
import { displayCurrency } from './format';
import { t, tList } from './i18n';

/** Categorías de fábrica con chistes propios (jokes.<tema> en i18n); las demás usan jokes.generic. */
const JOKE_TOPICS = ['comida', 'supermercado', 'transporte', 'gasolina', 'ocio', 'ropa', 'hogar'];
/** Id fijo del aviso único de la opción nueva. */
const ANNOUNCE_ID = 7_301_015;

/** "Personalidad" de la app: con "Chistosa", un chiste corto al registrar un gasto grande. */
@Injectable({ providedIn: 'root' })
export class PersonalityService {
  private readonly container = inject(APP_CONTAINER);
  private readonly toasts = inject(ToastController);

  readonly mode = signal<Personality>('off');

  /** Lee el ajuste guardado (Ajustes lo muestra). */
  async load(): Promise<void> {
    this.mode.set(await this.container.personality.get());
  }

  async setMode(mode: Personality): Promise<void> {
    await this.container.personality.set(mode);
    this.mode.set(mode);
  }

  /** Después de guardar un movimiento nuevo. Con la personalidad desactivada no hace nada. */
  async afterSave(tx: { date: string; amount: number; categoryId: string }): Promise<void> {
    if ((await this.container.personality.get()) !== 'funny') return;
    if (!(await this.container.checkBigExpense.execute(tx, displayCurrency()))) return;
    const topic = JOKE_TOPICS.find((topic) => tx.categoryId === `cat-${topic}`) ?? 'generic';
    const jokes = tList(`jokes.${topic}`);
    if (!jokes.length) return;
    const [lastTopic, lastIndex] = ((await this.container.personality.lastJoke()) ?? '').split(':');
    const index = pickIndex(jokes.length, lastTopic === topic ? Number(lastIndex) : null, Math.random());
    await this.container.personality.setLastJoke(`${topic}:${index}`);
    const toast = await this.toasts.create({ message: jokes[index], duration: 4500, position: 'top', cssClass: 'app-toast' });
    await toast.present();
  }

  /**
   * Una sola vez, al abrir la app ya actualizada: una notificación que cuenta de la opción nueva y dónde está.
   * Sin permiso de notificaciones no sale (las novedades de la versión también lo cuentan).
   */
  async announceOnce(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    if (!(await this.container.personality.announceOnce())) return;
    if ((await this.container.personality.get()) === 'funny') return;
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: ANNOUNCE_ID,
          title: t('personality.announceTitle'),
          body: t('personality.announceBody', {
            path: [t('ajustes.title'), t('ajustes.sections.avisos.title'), t('personality.label')].join(' › '),
          }),
          extra: { target: '/ajustes/avisos' },
        },
      ],
    });
  }
}
