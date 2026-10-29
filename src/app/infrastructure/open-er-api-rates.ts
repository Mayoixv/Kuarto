import { ExchangeRate, IExchangeRateSource } from '../application/use-cases/exchange-rate';

/**
 * Tipo de cambio de open.er-api.com (ExchangeRate-API, acceso libre sin clave). Se actualiza una vez al día y pide
 * citar la fuente donde se muestra la tasa. La petición no lleva ningún dato del usuario.
 */
const URL = 'https://open.er-api.com/v6/latest/USD';

export class OpenErApiRates implements IExchangeRateSource {
  async latest(): Promise<ExchangeRate> {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`open.er-api respondió ${res.status}`);
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    const usdToDop = data.rates?.['DOP'];
    if (data.result !== 'success' || typeof usdToDop !== 'number' || !(usdToDop > 0)) {
      throw new Error('La respuesta no trae la tasa del peso dominicano');
    }
    const updated = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000) : new Date();
    return { usdToDop, date: updated.toISOString().slice(0, 10) };
  }
}
