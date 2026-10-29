import { IsoDate } from '../../domain/month';
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

export class GetExchangeRate {
  constructor(
    private readonly settings: ISettingsRepository,
    private readonly source: IExchangeRateSource,
  ) {}

  /** La última tasa guardada, sin conexión. */
  async cached(): Promise<StoredRate | null> {
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
