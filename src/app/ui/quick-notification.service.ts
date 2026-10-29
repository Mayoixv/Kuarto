import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { APP_CONTAINER } from '../app.container';
import { errorText, t } from './i18n';
import { formatMoney, todayIso } from './format';
import { MonthState } from './month-state';
import { PersonalityService } from './personality.service';
import { TransactionFormService } from './movimientos/transaction-form.service';
import { UndoService } from './undo.service';
import { ToastController } from '@ionic/angular';

const KEY = 'quick_notification';
/** Id fijo: la misma notificación se vuelve a publicar después de cada uso. */
const QUICK_ID = 7_301_017;
const ACTION_TYPE = 'kuarto-registrar';
const ACTION_ID = 'registrar';
/** Canal silencioso: la notificación fija no debe sonar cada vez que se vuelve a publicar. */
const CHANNEL = 'kuarto-registrar';

/**
 * Notificación fija (opcional, apagada por defecto) con la acción "Registrar gasto": se escribe "500 gasolina" sin
 * abrir el formulario. Android abre la app al enviar; ahí se guarda y se ofrece deshacer.
 */
@Injectable({ providedIn: 'root' })
export class QuickNotificationService {
  private readonly container = inject(APP_CONTAINER);
  private readonly monthState = inject(MonthState);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastController);
  private readonly personality = inject(PersonalityService);
  private readonly form = inject(TransactionFormService);

  readonly available = Capacitor.isNativePlatform();
  readonly enabled = signal(false);

  /** Al abrir la app: escucha la acción y, si está activada, vuelve a publicar la notificación. */
  start(): void {
    if (!this.available) return;
    LocalNotifications.addListener('localNotificationActionPerformed', ({ notification, actionId, inputValue }) => {
      if (notification.id !== QUICK_ID) return;
      if (actionId === ACTION_ID) this.register(inputValue ?? '').catch(console.error);
      // Tocar la notificación (no el botón) abre el formulario completo.
      else if (actionId === 'tap') this.form.open().catch(console.error);
    });
    this.refresh().catch(console.error);
  }

  private async refresh(): Promise<void> {
    this.enabled.set((await this.container.settings.get(KEY)) === '1');
    // Si se apagó (o se borraron los datos), que no quede publicada.
    if (this.enabled()) await this.post();
    else await LocalNotifications.cancel({ notifications: [{ id: QUICK_ID }] });
  }

  /** Devuelve false si Android no da permiso de notificaciones. */
  async setEnabled(on: boolean): Promise<boolean> {
    if (on && (await LocalNotifications.requestPermissions()).display !== 'granted') return false;
    await this.container.settings.set(KEY, on ? '1' : '0');
    await this.refresh();
    return true;
  }

  private async post(): Promise<void> {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await LocalNotifications.createChannel({ id: CHANNEL, name: t('quickNotif.channel'), importance: 2, vibration: false });
    await LocalNotifications.registerActionTypes({
      types: [{ id: ACTION_TYPE, actions: [{ id: ACTION_ID, title: t('quickNotif.action'), input: true }] }],
    });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: QUICK_ID,
          title: t('quickNotif.title'),
          body: t('quickNotif.body'),
          channelId: CHANNEL,
          actionTypeId: ACTION_TYPE,
          ongoing: true,
          autoCancel: false,
        },
      ],
    });
  }

  /** Guarda lo escrito como gasto de hoy y ofrece deshacer. La notificación se vuelve a publicar siempre. */
  private async register(text: string): Promise<void> {
    try {
      const saved = await this.container.addQuickExpense.execute(text, todayIso());
      this.monthState.notifyChange();
      const category = (await this.container.categories.get(saved.categoryId))?.name ?? '';
      this.personality.afterSave(saved).catch(console.error);
      await this.undo.offer(t('quickNotif.saved', { amount: formatMoney(saved.amount), category }), async () => {
        await this.container.deleteTransaction.execute(saved.id);
      });
    } catch (error) {
      const toast = await this.toasts.create({ message: errorText(error, 'common.saveFailed'), duration: 5000, position: 'top', cssClass: 'app-toast' });
      await toast.present();
    } finally {
      await this.post().catch(console.error);
    }
  }
}
