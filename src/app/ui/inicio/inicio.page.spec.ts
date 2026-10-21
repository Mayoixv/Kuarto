import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { APP_CONTAINER, buildContainer } from '../../app.container';
import {
  InMemoryBudgets,
  InMemoryAccounts,
  InMemoryCategories,
  InMemoryDebts,
  InMemoryRecurring,
  InMemorySavings,
  InMemorySettings,
  InMemoryTransactions,
  SequentialIds,
} from '../../application/testing/in-memory';
import { monthLabel } from '../format';
import { MonthState } from '../month-state';
import { groupSlices } from './expense-donut.component';
import { InicioPage } from './inicio.page';

async function render(withData: boolean) {
  const categories = new InMemoryCategories();
  const transactions = new InMemoryTransactions();
  const repos = {
    categories,
    transactions,
    recurring: new InMemoryRecurring(),
    savings: new InMemorySavings(),
    budgets: new InMemoryBudgets(),
    settings: new InMemorySettings(),
    backup: { dump: () => Promise.reject(), restore: () => Promise.reject(), wipe: () => Promise.reject() },
    debts: new InMemoryDebts(),
    accounts: new InMemoryAccounts(transactions, categories),
    secrets: new InMemorySettings(),
  };
  repos.categories.items.set('sal', { id: 'sal', name: 'Salario', type: 'ingreso' });
  repos.categories.items.set('com', { id: 'com', name: 'Comida', type: 'variable' });
  const container = buildContainer(repos, new SequentialIds());
  if (withData) {
    await container.addTransaction.execute({ date: '2026-10-01', amount: 100000, categoryId: 'sal' });
    await container.addTransaction.execute({ date: '2026-10-02', amount: 25000, categoryId: 'com' });
  }
  TestBed.configureTestingModule({
    imports: [InicioPage],
    providers: [provideIonicAngular(), provideRouter([]), { provide: APP_CONTAINER, useValue: container }],
  });
  TestBed.inject(MonthState).month.set('2026-10');
  const fixture = TestBed.createComponent(InicioPage);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('InicioPage', () => {
  it('sin movimientos explica qué hacer', async () => {
    const el = await render(false);
    expect(el.textContent).toContain(`Aún no registras movimientos en ${monthLabel('2026-10')}`);
    expect(el.textContent).toContain('Toca el botón + para registrar el primero');
  });

  it('con datos muestra balance, gasto por categoría y últimos movimientos', async () => {
    const el = await render(true);
    expect(el.textContent).toContain(`Balance de ${monthLabel('2026-10')}`);
    expect(el.textContent).toContain('750.00');
    expect(el.textContent).toContain('¿En qué se va el gasto?');
    expect(el.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('Comida 100%');
    expect(el.querySelectorAll('.row')).toHaveLength(2);
  });
});

describe('groupSlices', () => {
  const slice = (n: number) => ({ name: `c${n}`, amount: 10, percent: 10 });

  it('deja igual hasta 6 categorías y agrupa el resto en "Otras"', () => {
    expect(groupSlices([1, 2, 3, 4, 5, 6].map(slice))).toHaveLength(6);
    const grouped = groupSlices([1, 2, 3, 4, 5, 6, 7, 8].map(slice));
    expect(grouped).toHaveLength(6);
    expect(grouped[5]).toEqual({ name: 'Otras', amount: 30, percent: 30 });
  });
});
