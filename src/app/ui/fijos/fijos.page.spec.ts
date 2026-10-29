import { TestBed } from '@angular/core/testing';
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
import { currentMonth } from '../format';
import { MonthState } from '../month-state';
import { FijosPage } from './fijos.page';

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
  repos.categories.items.set('ren', { id: 'ren', name: 'Alquiler', type: 'fijo' });
  // Sin red en las pruebas: el tipo de cambio queda sin tasa.
  const container = buildContainer(repos, new SequentialIds(), { latest: () => Promise.reject(new Error('sin red')) });
  const month = currentMonth();
  if (withData) {
    await container.addRecurringExpense.execute({
      name: 'Renta',
      amount: 1500000,
      categoryId: 'ren',
      dueDay: 5,
      startMonth: month,
    });
  }
  TestBed.configureTestingModule({
    imports: [FijosPage],
    providers: [provideIonicAngular(), { provide: APP_CONTAINER, useValue: container }],
  });
  TestBed.inject(MonthState).month.set(month);
  const fixture = TestBed.createComponent(FijosPage);
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
  };
  fixture.detectChanges();
  await settle();
  return { el: fixture.nativeElement as HTMLElement, settle, repos };
}

describe('FijosPage', () => {
  it('sin gastos fijos invita a agregar el primero', async () => {
    const { el } = await render(false);
    expect(el.textContent).toContain('Agrega tu primer pago fijo');
    expect(el.querySelector('.empty-action')?.textContent).toContain('Agregar pago fijo');
  });

  it('muestra el gasto pendiente y al marcarlo pagado crea la transacción y actualiza el estado', async () => {
    const { el, settle, repos } = await render(true);
    expect(el.textContent).toContain('Renta');
    // Venció hace 3 días: el chip dice Vencido, en rojo.
    expect(el.querySelector('.status-chip.overdue')?.textContent).toContain('Vencido');
    expect(el.textContent).toContain('15,000.00');

    (el.querySelector('button.pay') as HTMLButtonElement).click();
    await settle();
    await settle();

    expect(el.querySelector('.status-chip.paid')?.textContent).toContain('Pagado');
    expect(el.textContent).toContain('Todo pagado');
    const saved = await repos.transactions.listByMonth(currentMonth());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ amount: 1500000, categoryId: 'ren', note: 'Renta' });
  });
});
