import { convertCents, otherCurrency } from '../../domain/currency';
import { InMemorySettings } from '../testing/in-memory';
import { ExchangeRate, GetExchangeRate, IExchangeRateSource } from './exchange-rate';

class FakeSource implements IExchangeRateSource {
  calls = 0;
  next: ExchangeRate | Error = { usdToDop: 60.5, date: '2026-10-28' };
  async latest(): Promise<ExchangeRate> {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe('tipo de cambio', () => {
  it('consulta como mucho una vez al día y guarda la tasa', async () => {
    const source = new FakeSource();
    const rates = new GetExchangeRate(new InMemorySettings(), source);
    expect(await rates.cached()).toBeNull();
    expect((await rates.refresh('2026-10-28'))?.usdToDop).toBe(60.5);
    await rates.refresh('2026-10-28');
    expect(source.calls).toBe(1);

    source.next = { usdToDop: 61, date: '2026-10-29' };
    expect((await rates.refresh('2026-10-29'))?.usdToDop).toBe(61);
    expect(source.calls).toBe(2);
    expect((await rates.cached())?.date).toBe('2026-10-29');
  });

  it('sin internet o con una respuesta rara, se queda con la última guardada', async () => {
    const source = new FakeSource();
    const rates = new GetExchangeRate(new InMemorySettings(), source);
    source.next = new Error('sin conexión');
    expect(await rates.refresh('2026-10-28')).toBeNull();

    source.next = { usdToDop: 60.5, date: '2026-10-28' };
    await rates.refresh('2026-10-28');
    source.next = new Error('sin conexión');
    expect((await rates.refresh('2026-10-29'))?.usdToDop).toBe(60.5);
    source.next = { usdToDop: Number.NaN, date: '2026-10-30' };
    expect((await rates.refresh('2026-10-30'))?.usdToDop).toBe(60.5);
  });

  it('el equivalente se calcula en centavos hacia la otra moneda', () => {
    expect(otherCurrency('DOP')).toBe('USD');
    expect(otherCurrency('USD')).toBe('DOP');
    expect(convertCents(6050, 'DOP', 60.5)).toBe(100);
    expect(convertCents(100, 'USD', 60.5)).toBe(6050);
    expect(convertCents(-12100, 'DOP', 60.5)).toBe(-200);
  });
});
