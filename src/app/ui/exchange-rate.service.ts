import { inject, Injectable, signal } from '@angular/core';
import { APP_CONTAINER } from '../app.container';
import { ExchangeRate } from '../application/use-cases/exchange-rate';
import { convertCents, otherCurrency } from '../domain/currency';
import { CurrencyState } from './currency-state';
import { MonthState } from './month-state';
import { formatDay, formatMoneyIn, todayIso } from './format';

/**
 * Tipo de cambio DOP ↔ USD, solo para mostrar equivalentes. Al abrir la app usa la última tasa guardada y, si es de
 * otro día, la consulta una vez. Sin internet se queda con la guardada.
 */
@Injectable({ providedIn: 'root' })
export class ExchangeRateService {
  private readonly container = inject(APP_CONTAINER);
  private readonly currency = inject(CurrencyState);
  private readonly monthState = inject(MonthState);

  readonly rate = signal<ExchangeRate | null>(null);
  /** Si la tasa que se usa es la que fijó el usuario. */
  readonly isManual = signal(false);

  constructor() {
    this.load().catch(console.error);
  }

  private async load() {
    this.isManual.set(!!(await this.container.exchangeRate.manual()));
    const saved = await this.container.exchangeRate.cached();
    if (saved) this.rate.set(saved);
    const fresh = await this.container.exchangeRate.refresh(todayIso());
    if (fresh) this.rate.set(fresh);
  }

  /** Fija o quita la tasa propia y recarga las pantallas que suman en la moneda principal. */
  async setManual(usdToDop: number | null) {
    await this.container.exchangeRate.setManual(usdToDop, todayIso());
    if (usdToDop === null) this.rate.set(null);
    await this.load();
    this.monthState.notifyChange();
  }

  /** El monto (en la moneda que se muestra) en la otra moneda, ya con formato; null si todavía no hay tasa. */
  equivalent(cents: number): string | null {
    const rate = this.rate();
    if (!rate) return null;
    const from = this.currency.currency();
    return formatMoneyIn(convertCents(cents, from, rate.usdToDop), otherCurrency(from));
  }

  /** "1 US$ = RD$60.82": la tasa con formato. */
  rateText(): string | null {
    const rate = this.rate();
    return rate ? `1 US$ = ${formatMoneyIn(Math.round(rate.usdToDop * 100), 'DOP')}` : null;
  }

  /** Día de la tasa, corto ("29 oct"). */
  rateDay(): string | null {
    const rate = this.rate();
    return rate ? formatDay(rate.date) : null;
  }
}
