import { inAmountRange, parseAmountFilter } from './amount-filter';

describe('filtro por monto en la búsqueda', () => {
  it('entiende mayor, menor y rango, y deja el resto como texto', () => {
    expect(parseAmountFilter('uber >300')).toEqual({ min: 30000, max: null, text: 'uber' });
    expect(parseAmountFilter('<1000')).toEqual({ min: null, max: 100000, text: '' });
    expect(parseAmountFilter('> 1,500.50'.replace(',', ''))).toEqual({ min: 150050, max: null, text: '' });
    expect(parseAmountFilter('500-1000 super')).toEqual({ min: 50000, max: 100000, text: 'super' });
    expect(parseAmountFilter('1000-500')).toEqual({ min: 50000, max: 100000, text: '' });
    expect(parseAmountFilter('>=200 <=400')).toEqual({ min: 20000, max: 40000, text: '' });
  });

  it('no toma por monto palabras con números ni guiones de texto', () => {
    expect(parseAmountFilter('google one')).toEqual({ min: null, max: null, text: 'google one' });
    expect(parseAmountFilter('mes 2-a')).toEqual({ min: null, max: null, text: 'mes 2-a' });
    expect(parseAmountFilter('pago500')).toEqual({ min: null, max: null, text: 'pago500' });
  });

  it('compara con los límites incluidos', () => {
    expect(inAmountRange(30000, { min: 30000, max: null })).toBe(true);
    expect(inAmountRange(29999, { min: 30000, max: null })).toBe(false);
    expect(inAmountRange(100000, { min: null, max: 100000 })).toBe(true);
    expect(inAmountRange(5, { min: null, max: null })).toBe(true);
  });
});
