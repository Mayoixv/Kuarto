import { Location } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { CalendarDay, CalendarEvent } from '../../application/use-cases/get-month-calendar';
import { monthOf } from '../../domain/month';
import { formatAccountMoney, formatDay, formatMoney, todayIso } from '../format';
import { LoadingComponent } from '../loading.component';
import { HelpButtonComponent } from '../help/help-button.component';
import { MonthState } from '../month-state';
import { MonthSwitcherComponent } from '../month-switcher.component';
import { locale, t } from '../i18n';

/** Lunes primero, como el selector de fechas de la app. */
const weekdays = () =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));

/** Calendario del mes: qué se paga, qué se cobra y qué se movió cada día. */
@Component({
  selector: 'app-calendario',
  templateUrl: 'calendario.page.html',
  styleUrls: ['calendario.page.scss'],
  imports: [IonContent, IonIcon, LoadingComponent, MonthSwitcherComponent, HelpButtonComponent],
})
export class CalendarioPage {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly location = inject(Location);
  protected readonly monthState = inject(MonthState);

  protected readonly days = signal<CalendarDay[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly selected = signal<string | null>(null);
  protected readonly weekdays = weekdays();
  protected readonly today = todayIso();
  protected readonly money = formatMoney;
  protected readonly dayLabel = formatDay;

  /** Huecos antes del día 1 para que caiga en su día de la semana. */
  protected readonly lead = computed(() => {
    const first = this.days()?.[0]?.date;
    if (!first) return [];
    const [y, m] = first.split('-').map(Number);
    return Array.from({ length: (new Date(y, m - 1, 1).getDay() + 6) % 7 });
  });
  protected readonly selectedDay = computed(() => this.days()?.find((d) => d.date === this.selected()) ?? null);
  /** Totales del mes por tipo, para la línea de resumen. */
  protected readonly totals = computed(() => {
    const events = (this.days() ?? []).flatMap((d) => d.events.filter((e) => !e.account));
    const sum = (kind: CalendarEvent['kind'][]) => events.filter((e) => kind.includes(e.kind) && e.status !== 'hecho').reduce((s, e) => s + e.amount, 0);
    return { toPay: sum(['pago', 'cuota']), toCollect: sum(['cobro']) };
  });

  constructor() {
    addIcons({ chevronBack });
    effect(() => {
      const month = this.monthState.month();
      this.monthState.version();
      this.load(month);
    });
  }

  protected back() {
    this.location.back();
  }

  protected amount(e: CalendarEvent): string {
    return e.account ? formatAccountMoney(e.amount, e.account) : formatMoney(e.amount);
  }

  /** Lo que dice el lector de pantalla de cada día. */
  protected dayAria(d: CalendarDay): string {
    const parts = [this.dayLabel(d.date)];
    if (d.events.length) parts.push(t('calendar.eventsCount', { count: d.events.length }));
    if (d.spent) parts.push(t('calendar.spent', { amount: this.money(d.spent) }));
    if (d.earned) parts.push(t('calendar.earned', { amount: this.money(d.earned) }));
    return parts.join(', ');
  }

  /** El tono del punto del día: vencido manda sobre pendiente, y pendiente sobre hecho. */
  protected tone(d: CalendarDay): string | null {
    if (d.events.some((e) => e.status === 'vencido')) return 'vencido';
    if (d.events.some((e) => e.status === 'pendiente')) return 'pendiente';
    return d.events.length ? 'hecho' : null;
  }

  private async load(month: string) {
    try {
      const days = await this.container.getMonthCalendar.execute(month, this.today);
      if (month !== this.monthState.month()) return;
      this.days.set(days);
      // Se abre en hoy si es este mes; si no, en el primer día con algo.
      this.selected.set(monthOf(this.today) === month ? this.today : (days.find((d) => d.events.length)?.date ?? days[0].date));
      this.failed.set(false);
    } catch (error) {
      console.error(error);
      this.failed.set(true);
    }
  }
}
