import { webcrypto } from 'node:crypto';
import {
  InMemoryCategories,
  InMemoryRecurring,
  InMemorySavings,
  InMemorySettings,
  InMemoryTransactions,
} from '../testing/in-memory';
import { ValidationError } from '../errors';
import { DeleteSavingsContribution, RestoreSavingsContribution } from './delete-savings-contribution';
import { DeleteTransaction, RestoreTransaction } from './delete-transaction';
import { ExportTransactionsCsv } from './export-csv';
import { GetMonthRecurringExpenses } from './get-month-recurring-expenses';
import { PayRecurringExpense } from './pay-recurring-expense';
import { PinLock } from './pin-lock';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('PIN', () => {
  it('guarda solo un hash, acepta el PIN correcto y rechaza formatos inválidos', async () => {
    const settings = new InMemorySettings();
    const pin = new PinLock(settings);
    expect(await pin.isEnabled()).toBe(false);
    await expect(pin.enable('12a4')).rejects.toThrow(ValidationError);
    await pin.enable('2468');
    expect(await pin.length()).toBe(4);
    expect(await pin.lockAfter()).toBe(60);
    await pin.setLockAfter(0);
    expect(await pin.lockAfter()).toBe(0);
    await expect(pin.setLockAfter(30)).rejects.toThrow(ValidationError);
    expect(await pin.isEnabled()).toBe(true);
    expect([...settings.values.values()].join()).not.toContain('2468');
    expect(await pin.verify('2468')).toEqual({ ok: true });
    expect(await pin.verify('1111')).toEqual({ ok: false, waitSeconds: 0 });
  });

  it('tras 5 fallos hace esperar 30 s y luego el doble', async () => {
    const pin = new PinLock(new InMemorySettings());
    await pin.enable('2468');
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect((await pin.verify('0000', t0)).ok).toBe(false);
    expect(await pin.verify('0000', t0)).toEqual({ ok: false, waitSeconds: 30 });
    // Bloqueado: ni el PIN correcto entra hasta que pase la espera.
    expect(await pin.verify('2468', t0 + 10_000)).toEqual({ ok: false, waitSeconds: 20 });
    expect(await pin.verify('0000', t0 + 31_000)).toEqual({ ok: false, waitSeconds: 60 });
    expect(await pin.verify('2468', t0 + 92_000)).toEqual({ ok: true });
  });

  it('quitar el PIN exige el actual', async () => {
    const pin = new PinLock(new InMemorySettings());
    await pin.enable('2468');
    expect((await pin.disable('1357')).ok).toBe(false);
    expect(await pin.isEnabled()).toBe(true);
    expect((await pin.disable('2468')).ok).toBe(true);
    expect(await pin.isEnabled()).toBe(false);
  });
});

describe('deshacer', () => {
  it('deshacer el borrado de un pago de gasto fijo vuelve a dejarlo pagado', async () => {
    const tx = new InMemoryTransactions();
    const recurring = new InMemoryRecurring();
    recurring.items.set('r1', { id: 'r1', name: 'Renta', amount: 800, categoryId: 'ren', dueDay: 5, active: true, startMonth: '2026-01' });
    await new GetMonthRecurringExpenses(recurring).execute('2026-10');
    let n = 0;
    const paid = await new PayRecurringExpense(recurring, tx, { next: () => `t${++n}` }).execute({
      recurringExpenseId: 'r1', month: '2026-10', paidDate: '2026-10-05',
    });
    const deleted = await new DeleteTransaction(tx, recurring).execute(paid.transactionId!);
    expect((await recurring.listInstances('2026-10'))[0].status).toBe('pendiente');

    await new RestoreTransaction(tx, recurring).execute(deleted);
    expect(await tx.get(paid.transactionId!)).toBeTruthy();
    expect((await recurring.listInstances('2026-10'))[0]).toMatchObject({ status: 'pagado', transactionId: paid.transactionId });
  });

  it('deshacer el borrado de un aporte lo devuelve', async () => {
    const savings = new InMemorySavings();
    savings.contributions.set('a', { id: 'a', goalId: 'g', date: '2026-10-01', amount: 500 });
    const removed = await new DeleteSavingsContribution(savings).execute('a');
    expect(await savings.listContributions()).toEqual([]);
    await new RestoreSavingsContribution(savings).execute(removed!);
    expect(await savings.listContributions()).toHaveLength(1);
  });
});

describe('CSV', () => {
  it('exporta con BOM, montos en decimal y comillas solo donde hace falta', async () => {
    const tx = new InMemoryTransactions();
    const cats = new InMemoryCategories();
    cats.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
    cats.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
    await tx.save({ id: '1', date: '2026-10-02', amount: 125050, categoryId: 'com', note: 'Súper, ' + '"grande"' });
    await tx.save({ id: '2', date: '2026-10-01', amount: 6000000, categoryId: 'sal', note: '' });
    const { csv, rows } = await new ExportTransactionsCsv(tx, cats).execute();
    expect(rows).toBe(2);
    expect(csv).toBe(
      '\uFEFFfecha,tipo,categoría,monto,nota,etiquetas,moneda\r\n' +
        '2026-10-01,ingreso,Salario,60000.00,,,DOP\r\n' +
        '2026-10-02,gasto,Comida,1250.50,"Súper, ""grande""' + '",,DOP\r\n',
    );
  });
});
