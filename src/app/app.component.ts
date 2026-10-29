import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { LockScreenComponent } from './ui/lock/lock-screen.component';
import { LockState } from './ui/lock/lock-state';
import { NotificationsService } from './ui/notifications.service';
import { AutoBackupService } from './ui/auto-backup.service';
import { TourComponent } from './ui/tour/tour.component';
import { UpdateService } from './ui/update/update.service';
import { PersonalityService } from './ui/personality.service';
import { QuickNotificationService } from './ui/quick-notification.service';
import { NewsService } from './ui/news/news.service';
import { AlertController } from '@ionic/angular';
import { APP_CONTAINER } from './app.container';
import { askName } from './ui/profile-name';
import { MonthState } from './ui/month-state';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, LockScreenComponent, TourComponent],
})
export class AppComponent {
  protected readonly lock = inject(LockState);
  /** Se crea al arrancar para que reprograme los avisos con cada cambio de datos. */
  private readonly notifications = inject(NotificationsService);
  /** Hace el respaldo semanal al abrir la app, si toca. */
  private readonly autoBackup = inject(AutoBackupService);
  /** Busca una versión nueva al abrir la app, una vez al día. */
  private readonly update = inject(UpdateService);

  constructor() {
    // Un momento después de abrir, para no tapar la primera pantalla mientras carga.
    const news = inject(NewsService);
    const personality = inject(PersonalityService);
    // Notificación fija para registrar un gasto (si está activada) y su acción "Registrar gasto".
    inject(QuickNotificationService).start();
    setTimeout(
      () =>
        news
          .showIfUpdated()
          .then((updated) => (updated ? personality.announceOnce().catch(console.error) : undefined))
          .then(() => this.askNameOnce())
          .catch(console.error),
      1500,
    );
  }

  private readonly container = inject(APP_CONTAINER);
  private readonly alerts = inject(AlertController);
  private readonly monthState = inject(MonthState);

  /** Quien ya usaba la app no ve las preguntas iniciales: solo se le pide el nombre, una vez y con "Omitir". */
  private async askNameOnce() {
    const profile = this.container.profile;
    if ((await this.container.onboarding.needed()) || (await profile.name()) || (await profile.nameAsked())) return;
    await profile.markNameAsked();
    if (await askName(this.alerts, this.container, true)) this.monthState.notifyChange();
  }
}
