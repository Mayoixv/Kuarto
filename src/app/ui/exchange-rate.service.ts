import { inject, Injectable, signal } from '@angular/core';
import { APP_CONTAINER } from '../app.container';
import { ExchangeRate } from '../application/use-cases/exchange-rate';
import { convertCents, otherCurrency } from '../domain/currency';
import { CurrencyState } from './currency-state';
import { formatDay, formatMoneyIn, todayIso } from './format';

/**
 * Tipo de cambio DOP ↔ USD, solo para mostrar equivalentes. Al abrir la app usa la última tasa guardada y, si es de
 * otro día, la consulta una vez. Sin internet se queda con la guardada.
 */
@Injectable({ providedIn: 'root' })
export class ExchangeRateService {
  private readonly container = inject(APP_CONTAINER);
  private readonly currency = inject(CurrencyState);

  readonly rate = signal<ExchangeRate | null>(null);

  constructor() {
    this.container.exchangeRate
      .cached()
      .then((saved) => {
        if (saved) this.rate.set(saved);
        return this.container.exchangeRate.refresh(todayIso());
      })
      .then((fresh) => fresh && this.rate.set(fresh))
      .catch(console.error);
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
