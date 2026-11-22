import { canAfford, CashFlowInput } from './affordability';

const base = (over: Partial<CashFlowInput> = {}): CashFlowInput => ({
  available: 100_000,
  outflows: [],
  incomes: [],
  dailyBurn: 0,
  today: '2026-10-21', // faltan 11 días con hoy
  ...over,
});

describe('canAfford', () => {
  it('dice que sí y reparte lo que queda entre los días del mes', () => {
    const r = canAfford(10_000, base({ outflows: [{ date: '2026-10-28', amount: 20_000, label: 'Luz' }] }));
    expect(r).toMatchObject({ verdict: 'si', left: 70_000, perDay: 6363, days: 11, pending: 20_000, lowest: 70_000, lowestDate: '2026-10-28' });
    expect(r.bottleneck).toBeUndefined();
  });

  it('avisa que queda justo si se va más de la mitad de lo libre', () => {
    expect(canAfford(50_000, base({ outflows: [{ date: '2026-10-28', amount: 20_000, label: 'Luz' }] })).verdict).toBe('justo');
  });

  it('ve el bache antes del cobro: hoy hay dinero, pero el alquiler vence antes de la quincena', () => {
    const r = canAfford(
      30_000,
      base({
        available: 60_000,
        outflows: [{ date: '2026-10-25', amount: 50_000, label: 'Alquiler' }],
        incomes: [{ date: '2026-10-30', amount: 80_000 }],
      }),
    );
    // A fin de mes sobra, pero el 25 faltarían 20,000.
    expect(r.left).toBe(60_000);
    expect(r).toMatchObject({ verdict: 'espera', waitUntil: '2026-10-30', lowest: -20_000, lowestDate: '2026-10-25' });
    expect(r.bottleneck).toEqual({ date: '2026-10-25', label: 'Alquiler' });
  });

  it('cuenta el pago de la tarjeta en su fecha y los fijos vencidos hoy', () => {
    const r = canAfford(
      10_000,
      base({
        available: 50_000,
        outflows: [
          { date: '2026-10-10', amount: 15_000, label: 'Internet' }, // vencido: se cobra hoy
          { date: '2026-10-27', amount: 30_000, label: 'Tarjeta Popular' },
        ],
      }),
    );
    expect(r.pending).toBe(45_000);
    // Sin ningún cobro por venir, esperar no ayuda.
    expect(r).toMatchObject({ verdict: 'no', lowest: -5_000, lowestDate: '2026-10-27' });
    expect(r.bottleneck).toEqual({ date: '2026-10-27', label: 'Tarjeta Popular' });
  });

  it('mira los primeros días del mes siguiente: el alquiler del día 1 y el sueldo del día 5', () => {
    const input = base({
      available: 40_000,
      outflows: [{ date: '2026-11-01', amount: 35_000, label: 'Alquiler' }],
      incomes: [{ date: '2026-11-05', amount: 90_000 }],
    });
    const r = canAfford(10_000, input);
    expect(r).toMatchObject({ verdict: 'espera', waitUntil: '2026-11-05', lowestDate: '2026-11-01' });
    expect(r.bottleneck).toEqual({ date: '2026-11-01', label: 'Alquiler' });
    // Con 5,000 el día 1 queda exactamente en 0: alcanza, pero justo.
    expect(canAfford(5_000, input)).toMatchObject({ verdict: 'justo', lowest: 0 });
  });

  it('resta el ritmo de gasto diario y lo nombra si es lo que deja corto', () => {
    const r = canAfford(20_000, base({ available: 30_000, dailyBurn: 2_000 }));
    // 10,000 después de comprar, −2,000 por día desde mañana: el día 26 queda en 0 y el 27 en negativo.
    expect(r.verdict).toBe('no');
    expect(r.bottleneck).toEqual({ date: '2026-10-27', label: null });
    // El ritmo sigue hasta el 5 del mes siguiente: 15 días × 2,000 = 30,000.
    expect(canAfford(10_000, base({ available: 60_000, dailyBurn: 2_000 }))).toMatchObject({ verdict: 'si', lowest: 20_000, lowestDate: '2026-11-05' });
  });

  it('propone esperar al primer día en que alcanza, ignorando los cobros ya pasados', () => {
    const incomes = [
      { date: '2026-10-30', amount: 50_000 },
      { date: '2026-10-25', amount: 10_000 },
      { date: '2026-10-01', amount: 999_999 },
    ];
    const r = canAfford(100_000, base({ available: 60_000, incomes }));
    expect(r.verdict).toBe('espera');
    expect(r.waitUntil).toBe('2026-10-30');
  });

  it('dice que no si ni con los cobros alcanza', () => {
    expect(canAfford(100_000, base({ available: 10_000, incomes: [{ date: '2026-10-30', amount: 5_000 }] })).verdict).toBe('no');
  });
});
