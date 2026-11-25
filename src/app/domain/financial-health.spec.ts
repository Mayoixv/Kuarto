import { financialHealth } from './financial-health';

describe('salud financiera', () => {
  it('promedia los meses con datos y califica cada indicador', () => {
    const h = financialHealth({
      available: 9_000_000,
      history: [
        { income: 5_000_000, expenses: 3_000_000, saved: 1_000_000 },
        { income: 5_000_000, expenses: 3_000_000, saved: 1_000_000 },
        { income: 0, expenses: 0, saved: 0 },
      ],
      monthlyDebt: 1_000_000,
    });
    expect(h.months).toBe(2);
    expect(h.monthsCovered).toEqual({ value: 3, level: 'bueno' });
    expect(h.savingsRate).toEqual({ value: 20, level: 'bueno' });
    expect(h.debtToIncome).toEqual({ value: 20, level: 'bueno' });
  });

  it('niveles bajos y medios en los bordes', () => {
    const h = financialHealth({ available: 2_000_000, history: [{ income: 1_000_000, expenses: 2_500_000, saved: 50_000 }], monthlyDebt: 400_000 });
    expect(h.monthsCovered).toEqual({ value: 0.8, level: 'bajo' });
    expect(h.savingsRate).toEqual({ value: 5, level: 'bajo' });
    expect(h.debtToIncome).toEqual({ value: 40, level: 'bajo' });
    expect(financialHealth({ available: 0, history: [{ income: 100, expenses: 100, saved: 15 }], monthlyDebt: 30 }).debtToIncome?.level).toBe('medio');
  });

  it('sin datos no inventa indicadores; con saldo negativo cubre 0 meses', () => {
    expect(financialHealth({ available: 100, history: [], monthlyDebt: 0 })).toMatchObject({ monthsCovered: null, savingsRate: null, debtToIncome: null, months: 0 });
    expect(financialHealth({ available: -500, history: [{ income: 0, expenses: 100, saved: 0 }], monthlyDebt: 0 })).toMatchObject({
      monthsCovered: { value: 0, level: 'bajo' },
      savingsRate: null,
    });
  });
});
