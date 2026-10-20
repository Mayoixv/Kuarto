import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircle, cardOutline, chevronForward, timeOutline, trendingUpOutline } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Alerts } from '../../application/use-cases/get-alerts';
import { currentMonth, todayIso } from '../format';
import { MonthState } from '../month-state';
import { listText, t, tn } from '../i18n';

interface Alert {
  key: string;
  icon: string;
  tone: 'danger' | 'warning';
  text: string;
  target: 'fijos' | 'presupuestos' | 'cuentas';
}

/** "Luz", "Luz y Agua", "Luz, Agua y 2 más". */
function names(list: string[]): string {
  if (list.length === 1) return list[0];
  if (list.length === 2) return t('alerts.two', { a: list[0], b: list[1] });
  return t('alerts.more', { a: list[0], b: list[1], count: list.length - 2 });
}

function toAlerts(a: Alerts): Alert[] {
  const out: Alert[] = [];
  if (a.overdue.length) {
    out.push({
      key: 'overdue',
      icon: 'alert-circle',
      tone: 'danger',
      text: tn('alerts.overdue', a.overdue.length, { names: names(a.overdue) }),
      target: 'fijos',
    });
  }
  if (a.dueSoon.length) {
    out.push({
      key: 'soon',
      icon: 'time-outline',
      tone: 'warning',
      text: tn('alerts.soon', a.dueSoon.length, { names: names(a.dueSoon) }),
      target: 'fijos',
    });
  }
  if (a.cardsOverdue.length) {
    out.push({
      key: 'cards-overdue',
      icon: 'alert-circle',
      tone: 'danger',
      text: tn('alerts.cardsOverdue', a.cardsOverdue.length, { names: names(a.cardsOverdue) }),
      target: 'cuentas',
    });
  }
  if (a.cardsDue.length) {
    out.push({
      key: 'cards-due',
      icon: 'card-outline',
      tone: 'danger',
      text: tn('alerts.cardsDue', a.cardsDue.length, { names: names(a.cardsDue) }),
      target: 'cuentas',
    });
  }
  if (a.exceeded.length) {
    out.push({ key: 'exceeded', icon: 'alert-circle', tone: 'danger', text: t('alerts.exceeded', { names: names(a.exceeded) }), target: 'presupuestos' });
  }
  if (a.nearLimit.length) {
    out.push({
      key: 'near',
      icon: 'trending-up-outline',
      tone: 'warning',
      text: t('alerts.near', { names: names(a.nearLimit) }),
      target: 'presupuestos',
    });
  }
  if (a.cardsHighUse.length) {
    out.push({
      key: 'cards-use',
      icon: 'card-outline',
      tone: 'warning',
      text: t('alerts.cardsUse', { names: names(a.cardsHighUse) }),
      target: 'cuentas',
    });
  }
  return out;
}

/** Fila de alertas de Inicio: lo que pide atención hoy. Solo se ve en el mes actual y si hay algo. */
@Component({
  selector: 'app-alerts-row',
  templateUrl: 'alerts-row.component.html',
  styleUrls: ['alerts-row.component.scss'],
  imports: [IonIcon],
})
export class AlertsRowComponent {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly router = inject(Router);
  private readonly monthState = inject(MonthState);

  protected readonly alerts = signal<Alert[]>([]);
  protected readonly visible = computed(() => this.monthState.month() === currentMonth() && this.alerts().length > 0);

  constructor() {
    addIcons({ alertCircle, cardOutline, chevronForward, timeOutline, trendingUpOutline });
    effect(() => {
      this.monthState.version();
      this.load();
    });
  }

  protected open(alert: Alert) {
    if (alert.target !== 'presupuestos') {
      this.router.navigateByUrl(alert.target === 'fijos' ? '/tabs/fijos' : '/tabs/dinero?ver=tarjetas');
      return;
    }
    // Los presupuestos están más abajo en Inicio mismo.
    document.querySelector('app-budgets-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private async load() {
    try {
      this.alerts.set(toAlerts(await this.container.getAlerts.execute(todayIso(), listText)));
    } catch (error) {
      // Es una ayuda: si falla, no se muestra y el resto de Inicio sigue funcionando.
      console.error(error);
      this.alerts.set([]);
    }
  }
}
