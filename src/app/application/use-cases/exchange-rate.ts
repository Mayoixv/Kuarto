import { IsoDate } from '../../domain/month';
import { ValidationError } from '../errors';
import { ISettingsRepository } from '../ports/repositories';

/** Tasa del día: pesos por un dólar. Solo se usa para mostrar equivalentes; nunca convierte montos guardados. */
export interface ExchangeRate {
  usdToDop: number;
  /** Día de la tasa, según quien la publica. */
  date: IsoDate;
}

/** De dónde sale la tasa (un servicio en internet). Solo se le pide la tasa: no recibe ningún dato del usuario. */
export interface IExchangeRateSource {
  latest(): Promise<ExchangeRate>;
}

interface StoredRate extends ExchangeRate {
  /** Día en que se consultó: con él se limita a una consulta por día. */
  checked: IsoDate;
}

const KEY = 'fx_usd_dop';
/** Tasa que fija el usuario (la de su banco, o sin internet): manda sobre la del servicio hasta que la quite. */
const MANUAL_KEY = 'fx_manual';
/** Límites razonables de pesos por dólar, para no aceptar un error de tipeo como 5.9 o 59000. */
export const MANUAL_RATE_MIN = 1;
export const MANUAL_RATE_MAX = 1000;

export class GetExchangeRate {
  constructor(
    private readonly settings: ISettingsRepository,
    private readonly source: IExchangeRateSource,
  ) {}

  /** La tasa propia del usuario, si fijó una. */
  async manual(): Promise<ExchangeRate | null> {
    try {
      const saved = JSON.parse((await this.settings.get(MANUAL_KEY)) || 'null') as ExchangeRate | null;
      return saved && saved.usdToDop > 0 && saved.date ? saved : null;
    } catch {
      return null;
    }
  }

  /** Fija (o quita, con null) la tasa propia. */
  async setManual(usdToDop: number | null, today: IsoDate): Promise<void> {
    if (usdToDop === null) return this.settings.set(MANUAL_KEY, '');
    if (!Number.isFinite(usdToDop) || usdToDop < MANUAL_RATE_MIN || usdToDop > MANUAL_RATE_MAX) throw new ValidationError('fxRate');
    await this.settings.set(MANUAL_KEY, JSON.stringify({ usdToDop, date: today }));
  }

  /** La tasa que se usa sin conexión: la propia si hay, si no la última consultada. */
  async cached(): Promise<StoredRate | null> {
    const manual = await this.manual();
    // Con tasa propia no se consulta el servicio: "checked" en el futuro hace que refresh no lo llame.
    if (manual) return { ...manual, checked: '9999-12-31' };
    try {
      const saved = JSON.parse((await this.settings.get(KEY)) || 'null') as StoredRate | null;
      return saved && saved.usdToDop > 0 && saved.date && saved.checked ? saved : null;
    } catch {
      return null;
    }
  }

  /**
   * La tasa de hoy: si ya se consultó hoy, la guardada; si no, la pide (una vez al día).
   * Sin internet o con una respuesta rara, devuelve la última guardada (o null si nunca hubo).
   */
  async refresh(today: IsoDate): Promise<StoredRate | null> {
    const saved = await this.cached();
    if (saved && saved.checked >= today) return saved;
    try {
      const fresh = await this.source.latest();
      if (!Number.isFinite(fresh.usdToDop) || fresh.usdToDop <= 0) return saved;
      const rate: StoredRate = { usdToDop: fresh.usdToDop, date: fresh.date, checked: today };
      await this.settings.set(KEY, JSON.stringify(rate));
      return rate;
    } catch {
      return saved;
    }
  }
}
