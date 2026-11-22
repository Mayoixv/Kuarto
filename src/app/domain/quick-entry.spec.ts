import { Category } from './category';
import { parseQuickEntry, similar } from './quick-entry';

const categories: Category[] = [
  { id: 'cat-salario', name: 'Salario', type: 'ingreso' },
  { id: 'cat-gasolina', name: 'Gasolina', type: 'variable' },
  { id: 'cat-comida', name: 'Comida', type: 'variable' },
  { id: 'cat-transporte', name: 'Transporte', type: 'variable' },
  { id: 'cat-luz', name: 'Luz', type: 'fijo' },
  { id: 'cat-supermercado', name: 'Supermercado', type: 'variable' },
  { id: 'mia', name: 'Mascotas', type: 'variable' },
];

const accounts = [
  { id: 'acc-efectivo', name: 'Efectivo', archived: false },
  { id: 'acc-popular', name: 'Tarjeta Popular', archived: false },
  { id: 'acc-bhd', name: 'Tarjeta BHD', archived: false },
  { id: 'acc-banreservas', name: 'Banreservas', archived: false },
  { id: 'acc-vieja', name: 'Vieja', archived: true },
];
const context = { accounts, today: '2026-11-16' };

describe('parseQuickEntry', () => {
  it('entiende monto, categoría por nombre y nota', () => {
    expect(parseQuickEntry('Gasté 500 en gasolina', categories)).toEqual({
      amount: 50_000, kind: 'gasto', categoryId: 'cat-gasolina', accountId: null, date: null, tags: [], note: 'Gasolina',
    });
  });

  it('quita de la nota el monto escrito con separador de miles', () => {
    expect(parseQuickEntry('Gasté 1,250 en gasolina', categories).note).toBe('Gasolina');
    expect(parseQuickEntry('RD$ 300 de comida', categories).note).toBe('Comida');
  });

  it('lee miles con coma o punto, decimales, k y mil', () => {
    const amount = (text: string) => parseQuickEntry(text, categories).amount;
    expect(amount('1,500 comida')).toBe(150_000);
    expect(amount('1.500 comida')).toBe(150_000);
    expect(amount('RD$1500.50 comida')).toBe(150_050);
    expect(amount('1,500.50 de luz')).toBe(150_050);
    expect(amount('2k comida')).toBe(200_000);
    expect(amount('5 mil de comida')).toBe(500_000);
    expect(amount('gasté mil en comida')).toBe(100_000);
  });

  it('usa palabras clave de las categorías de la app', () => {
    const r = parseQuickEntry('uber 350', categories);
    expect(r.categoryId).toBe('cat-transporte');
    expect(r.note).toBe('Uber');
    expect(parseQuickEntry('1200 sirena', categories).categoryId).toBe('cat-supermercado');
  });

  it('aprende de notas anteriores, aun con una letra mal escrita', () => {
    const history = [{ note: 'Veterinario Max', categoryId: 'mia' }, { note: 'Comedor', categoryId: 'cat-comida' }];
    expect(parseQuickEntry('800 veterinario', categories, history).categoryId).toBe('mia');
    expect(parseQuickEntry('450 comedor', categories, history).categoryId).toBe('cat-comida');
    expect(parseQuickEntry('450 comedo', categories, history).categoryId).toBe('cat-comida');
    expect(parseQuickEntry('500 gasolna', categories).categoryId).toBe('cat-gasolina');
  });

  it('reconoce un ingreso aunque no sepa la categoría', () => {
    const r = parseQuickEntry('me pagaron 3000 por un trabajo', categories);
    expect(r).toMatchObject({ amount: 300_000, kind: 'ingreso', categoryId: null, note: 'Trabajo' });
    expect(parseQuickEntry('me entraron 5000 de un chequecito a banreservas', categories, [], context)).toMatchObject({
      amount: 500_000, kind: 'ingreso', accountId: 'acc-banreservas', note: 'Chequecito',
    });
  });

  it('entiende la cuenta por su nombre, sin confundir dos tarjetas', () => {
    expect(parseQuickEntry('di 200 de propina en efectivo', categories, [], context)).toMatchObject({
      amount: 20_000, kind: 'gasto', accountId: 'acc-efectivo', note: 'Propina',
    });
    const r = parseQuickEntry('pagué 1,500.50 de luz con la tarjeta popular ayer', categories, [], context);
    expect(r).toEqual({
      amount: 150_050, kind: 'gasto', categoryId: 'cat-luz', accountId: 'acc-popular', date: '2026-11-15', tags: [], note: 'Luz',
    });
    expect(parseQuickEntry('500 comida con la tarjeta', categories, [], context).accountId).toBeNull();
    expect(parseQuickEntry('500 comida vieja', categories, [], context).accountId).toBeNull();
  });

  it('entiende fechas relativas y etiquetas', () => {
    expect(parseQuickEntry('gasté 350 en uber #trabajo #viaje', categories, [], context)).toMatchObject({
      categoryId: 'cat-transporte', tags: ['trabajo', 'viaje'], note: 'Uber',
    });
    expect(parseQuickEntry('antier 300 comida', categories, [], context).date).toBe('2026-11-14');
    expect(parseQuickEntry('hace 3 días 300 comida', categories, [], context)).toMatchObject({ amount: 30_000, date: '2026-11-13', note: 'Comida' });
    expect(parseQuickEntry('hoy 300 comida', categories, [], context).date).toBe('2026-11-16');
    // Sin la fecha de hoy no se puede calcular, pero la palabra tampoco va en la nota.
    expect(parseQuickEntry('ayer 300 comida', categories)).toMatchObject({ date: null, note: 'Comida' });
  });

  it('sin monto lo deja en null', () => {
    expect(parseQuickEntry('comida', categories).amount).toBeNull();
  });

  it('similar tolera una letra solo en palabras largas', () => {
    expect(similar('gasolina', 'gasolna')).toBe(true);
    expect(similar('sirena', 'sirenа')).toBe(true);
    expect(similar('luz', 'lus')).toBe(false);
    expect(similar('comida', 'comedor')).toBe(false);
  });
});
