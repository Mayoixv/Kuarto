import { Location } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { IonContent, IonIcon, IonInput } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { compoundInterest, fire, futureCost, monthsToReach, purchasingPower } from '../../domain/calculators';
import { CurrencyState } from '../currency-state';
import { amountToInput, currentMonth, formatMoney, formatPercent } from '../format';
import { PillOption, PillToggleComponent } from '../pill-toggle.component';
import { HelpButtonComponent } from '../help/help-button.component';
import { t, tn } from '../i18n';

type Tool = 'interes' | 'inflacion' | 'libertad' | 'emergencia';
const TOOLS: Tool[] = ['interes', 'inflacion', 'libertad', 'emergencia'];

/** Lo escrito en un campo como número; vacío o inválido es 0 (las calculadoras no guardan nada). */
const num = (text: string) => {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const cents = (text: string) => Math.round(num(text) * 100);

/**
 * Calculadoras: interés compuesto, inflación, independencia financiera (regla del 4%) y fondo de emergencia. Solo
 * calculan con lo que se escribe; los montos de partida salen de tus propios datos.
 */
@Component({
  selector: 'app-calculadoras',
  templateUrl: 'calculadoras.page.html',
  styleUrls: ['calculadoras.page.scss'],
  imports: [IonContent, IonIcon, IonInput, PillToggleComponent, HelpButtonComponent],
})
export class CalculadorasPage implements OnInit {
  protected readonly t = t;
  protected readonly tn = tn;
  private readonly container = inject(APP_CONTAINER);
  private readonly location = inject(Location);
  protected readonly currency = inject(CurrencyState).currency;
  protected readonly money = formatMoney;
  protected readonly percent = formatPercent;

  protected readonly tool = signal<Tool>('interes');
  protected readonly options = computed<PillOption[]>(() => TOOLS.map((value) => ({ value, label: t('calc.tools.' + value) })));

  // Interés compuesto
  protected readonly ciInitial = signal('10000');
  protected readonly ciMonthly = signal('2000');
  protected readonly ciRate = signal('6');
  protected readonly ciYears = signal('10');
  protected readonly ci = computed(() => compoundInterest(cents(this.ciInitial()), cents(this.ciMonthly()), num(this.ciRate()), num(this.ciYears())));

  // Inflación
  protected readonly infAmount = signal('1000');
  protected readonly infRate = signal('4');
  protected readonly infYears = signal('10');
  protected readonly inf = computed(() => ({
    future: futureCost(cents(this.infAmount()), num(this.infRate()), num(this.infYears())),
    power: purchasingPower(cents(this.infAmount()), num(this.infRate()), num(this.infYears())),
  }));

  // Independencia financiera
  protected readonly fiExpenses = signal('');
  protected readonly fiWithdrawal = signal('4');
  protected readonly fiSaved = signal('');
  protected readonly fiMonthly = signal('');
  protected readonly fiReturn = signal('5');
  protected readonly fi = computed(() =>
    fire(cents(this.fiExpenses()), num(this.fiWithdrawal()), cents(this.fiSaved()), cents(this.fiMonthly()), num(this.fiReturn())),
  );

  // Fondo de emergencia
  protected readonly efMonthly = signal('');
  protected readonly efMonths = signal('6');
  protected readonly efSaved = signal('');
  protected readonly efSaving = signal('');
  protected readonly ef = computed(() => {
    const target = Math.round(cents(this.efMonthly()) * num(this.efMonths()));
    return { target, months: monthsToReach(target, cents(this.efSaved()), cents(this.efSaving())) };
  });

  constructor() {
    addIcons({ chevronBack });
  }

  /** Prellena con tu gasto mensual promedio y tu dinero disponible (se pueden cambiar). */
  async ngOnInit() {
    try {
      const [health, overview] = await Promise.all([
        this.container.getFinancialHealth.execute(currentMonth()),
        this.container.getAccountsOverview.execute(),
      ]);
      const saved = amountToInput(Math.max(0, overview.assets));
      if (health.expenses > 0) {
        this.fiExpenses.set(amountToInput(health.expenses * 12));
        this.efMonthly.set(amountToInput(health.expenses));
      }
      if (health.income > health.expenses) {
        const monthly = amountToInput(health.income - health.expenses);
        this.fiMonthly.set(monthly);
        this.efSaving.set(monthly);
      }
      this.fiSaved.set(saved);
      this.efSaved.set(saved);
    } catch (error) {
      // Sin datos se calcula igual con lo que se escriba.
      console.error(error);
    }
  }

  protected back() {
    this.location.back();
  }

  protected setTool(value: string) {
    this.tool.set(value as Tool);
  }

  /** Para los campos: lo escrito en el evento de ion-input. */
  protected value(event: CustomEvent): string {
    return String((event.detail as { value?: string | null }).value ?? '');
  }
}
