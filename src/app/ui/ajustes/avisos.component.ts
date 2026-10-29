import { Component, inject, signal, viewChild } from '@angular/core';
import { SelectFieldComponent } from '../select/select-field.component';
import { IonToggle } from '@ionic/angular';
import { NotificationPrefs, NotificationsService } from '../notifications.service';
import { PersonalityService } from '../personality.service';
import { QuickNotificationService } from '../quick-notification.service';
import { Personality } from '../../domain/personality';
import { t } from '../i18n';

/** Horas que se ofrecen, de 6:00 a 22:00. */
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

/** Sección "Avisos" de Ajustes: activar las notificaciones, elegir cuáles y a qué hora. */
const hourLabel = (h: number) => `${h}:00`;

@Component({
  selector: 'app-avisos',
  templateUrl: 'avisos.component.html',
  styleUrls: ['avisos.component.scss'],
  imports: [SelectFieldComponent, IonToggle],
})
export class AvisosComponent {
  protected readonly t = t;
  protected readonly notifications = inject(NotificationsService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly hourOptions = HOURS.map((h) => ({ value: h, label: hourLabel(h) }));
  protected readonly allHourOptions = Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }));
  private readonly mainToggle = viewChild<IonToggle>('main');
  protected readonly personality = inject(PersonalityService);
  protected readonly quick = inject(QuickNotificationService);
  private readonly quickToggle = viewChild<IonToggle>('quickToggle');
  protected readonly personalityOptions: { value: Personality; label: string }[] = [
    { value: 'off', label: t('personality.off') },
    { value: 'funny', label: t('personality.funny') },
  ];

  constructor() {
    this.personality.load().catch(console.error);
  }

  protected async toggle(on: boolean) {
    if (on === this.notifications.enabled()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (!on) await this.notifications.disable();
      else if (!(await this.notifications.enable())) {
        this.error.set(t('avisos.denied'));
      }
    } catch (e) {
      console.error(e);
      this.error.set(t('avisos.toggleFailed'));
    } finally {
      this.busy.set(false);
      // El interruptor cambia solo al tocarlo; si no se pudo, vuelve a mostrar el estado real.
      const toggle = this.mainToggle();
      if (toggle) toggle.checked = this.notifications.enabled();
    }
  }

  protected async set<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) {
    this.error.set('');
    try {
      await this.notifications.setPref(key, value);
    } catch (e) {
      console.error(e);
      this.error.set(t('avisos.saveFailed'));
    }
  }

  protected async setPersonality(mode: Personality) {
    this.error.set('');
    try {
      await this.personality.setMode(mode);
    } catch (e) {
      console.error(e);
      this.error.set(t('avisos.saveFailed'));
    }
  }

  protected async setQuick(on: boolean) {
    if (on === this.quick.enabled()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (!(await this.quick.setEnabled(on))) this.error.set(t('avisos.denied'));
    } catch (e) {
      console.error(e);
      this.error.set(t('avisos.saveFailed'));
    } finally {
      this.busy.set(false);
      const toggle = this.quickToggle();
      if (toggle) toggle.checked = this.quick.enabled();
    }
  }
}
