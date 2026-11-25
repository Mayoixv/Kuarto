import { compoundInterest, fire, futureCost, MAX_YEARS, monthsToReach, purchasingPower } from './calculators';

describe('calculadoras', () => {
  it('interés compuesto: sin tasa es la suma de los aportes; con tasa crece cada mes', () => {
    expect(compoundInterest(100_000, 10_000, 0, 1)).toEqual({ total: 220_000, contributed: 220_000, interest: 0, byYear: [220_000] });
    // RD$10,000 al 12% anual (1% al mes) por 1 año sin aportes: 10,000 × 1.01^12 = 11,268.25.
    const r = compoundInterest(1_000_000, 0, 12, 1);
    expect(r.total).toBe(1_126_825);
    expect(r.interest).toBe(126_825);
    expect(compoundInterest(1_000, 0, 10, 0).total).toBe(1_000);
    expect(compoundInterest(1, 0, 0, 10_000).byYear).toHaveLength(MAX_YEARS);
  });

  it('inflación: costo futuro y poder adquisitivo', () => {
    // 4% anual por 10 años: × 1.48024.
    expect(futureCost(100_000, 4, 10)).toBe(148_024);
    expect(purchasingPower(100_000, 4, 10)).toBe(67_556);
    expect(futureCost(100_000, 0, 30)).toBe(100_000);
    expect(purchasingPower(100_000, 4, -5)).toBe(100_000);
  });

  it('FIRE: meta de 25 veces el gasto con la regla del 4%, y años al ritmo dado', () => {
    expect(fire(60_000_000, 4, 0, 0, 5)).toEqual({ target: 1_500_000_000, years: null });
    expect(fire(60_000_000, 4, 1_500_000_000, 0, 5)).toEqual({ target: 1_500_000_000, years: 0 });
    // Sin rentabilidad: 1,500,000,000 / 12,500,000 al mes = 120 meses = 10 años.
    expect(fire(60_000_000, 4, 0, 12_500_000, 0).years).toBe(10);
    // Con rentabilidad se llega antes.
    expect(fire(60_000_000, 4, 0, 12_500_000, 7).years!).toBeLessThan(10);
    expect(fire(60_000_000, 0, 0, 1, 0)).toEqual({ target: 0, years: null });
  });

  it('meses para llegar a una meta', () => {
    expect(monthsToReach(600_000, 0, 100_000)).toBe(6);
    expect(monthsToReach(600_000, 550_000, 100_000)).toBe(1);
    expect(monthsToReach(600_000, 700_000, 0)).toBe(0);
    expect(monthsToReach(600_000, 0, 0)).toBeNull();
  });
});
