import { Location } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { HelpButtonComponent } from '../help/help-button.component';
import { Category } from '../../domain/category';
import { lookOf } from '../category-look';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Report } from '../../application/use-cases/get-report';
import {
  ColumnChartComponent,
  ColumnSeries,
} from '../charts/column-chart.component';
import { LineChartComponent } from '../charts/line-chart.component';
import { shortMonth } from '../charts/scale';
import {
  currentMonth,
  formatMoney,
  formatPercent,
  monthLabel,
} from '../format';
import { MonthState } from '../month-state';
import { PillOption, PillToggleComponent } from '../pill-toggle.component';
import { exportMonthPdf } from './month-pdf';
import { LoadingComponent } from '../loading.component';
import { t, tn } from '../i18n';
import { FinancialHealth } from '../../domain/financial-health';

/** Reportes del periodo que termina en el mes visto: por mes, por categoría y saldo de cuentas. */
@Component({
  selector: 'app-reportes',
  templateUrl: 'reportes.page.html',
  styleUrls: ['reportes.page.scss'],
  imports: [HelpButtonComponent, 
    LoadingComponent,
    IonContent,
    IonIcon,
    RouterLink,
    PillToggleComponent,
    ColumnChartComponent,
    LineChartComponent,
  ],
})
export class ReportesPage {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly location = inject(Location);
  protected readonly monthState = inject(MonthState);

  protected readonly range = signal('6');
  protected readonly rangeOptions = computed<PillOption[]>(() =>
    ['3', '6', '12'].map((value) => ({ value, label: t('reports.months', { count: value }) })),
  );
  protected readonly report = signal<Report | null>(null);
  protected readonly failed = signal(false);
  protected readonly showTable = signal(false);
  protected readonly categoryId = signal<string | null>(null);
  private readonly categories = signal<Category[]>([]);
  protected readonly money = formatMoney;
  protected readonly tn = tn;
  protected readonly groupCards = (r: Report) => [
    { key: 'byMerchant', items: r.byMerchant },
    { key: 'byTag', items: r.byTag },
  ];
  /** Indicadores de los últimos meses completos; no dependen del periodo elegido. */
  protected readonly health = signal<FinancialHealth | null>(null);
  protected readonly percent = formatPercent;
  private loadSeq = 0;

  protected readonly labels = computed(() =>
    (this.report()?.months ?? []).map(shortMonth),
  );
  protected readonly fullLabels = computed(() =>
    (this.report()?.months ?? []).map((m) => monthLabel(m)),
  );
  protected readonly isEmpty = computed(() => {
    const r = this.report();
    return (
      !!r &&
      r.summaries.every(
        (s) => s.income === 0 && s.expenses === 0 && s.saved === 0,
      )
    );
  });

  protected readonly monthSeries = computed<ColumnSeries[]>(() => {
    const s = this.report()?.summaries ?? [];
    return [
      {
        name: t('inicio.income'),
        color: 'var(--series-ingresos)',
        values: s.map((m) => m.income),
      },
      {
        name: t('inicio.expenses'),
        color: 'var(--series-gastos)',
        values: s.map((m) => m.expenses),
      },
    ];
  });

  protected readonly categoryRows = computed(() => {
    const cats = this.report()?.categories ?? [];
    const total = cats.reduce((s, c) => s + c.total, 0);
    const top = cats[0]?.total ?? 1;
    const byId = new Map(this.categories().map((c) => [c.id, c]));
    return cats.map((c) => ({
      ...c,
      color: lookOf(byId.get(c.categoryId) ?? { type: 'variable' }).color,
      width: (c.total / top) * 100,
      share: total ? (c.total / total) * 100 : 0,
    }));
  });

  protected readonly selectedCategory = computed(
    () =>
      this.categoryRows().find((c) => c.categoryId === this.categoryId()) ??
      null,
  );

  constructor() {
    addIcons({ chevronBack });
    effect(() => {
      const month = this.monthState.month();
      const count = Number(this.range());
      this.monthState.version();
      this.load(month, count);
    });
  }

  protected back() {
    this.location.back();
  }

  protected readonly exporting = signal(false);
  protected readonly exportError = signal('');
  protected readonly exportDone = signal('');

  protected async exportPdf() {
    this.exporting.set(true);
    this.exportError.set('');
    this.exportDone.set('');
    try {
      const where = await exportMonthPdf(this.container, this.monthState.month());
      if (where) this.exportDone.set(t('reports.pdfSaved', { where }));
    } catch (error) {
      console.error(error);
      this.exportError.set(t('reports.pdfFailed'));
    } finally {
      this.exporting.set(false);
    }
  }

  protected toggleCategory(id: string) {
    this.categoryId.set(this.categoryId() === id ? null : id);
  }

  private async load(month: string, count: number) {
    const seq = ++this.loadSeq;
    try {
      const report = await this.container.getReport.execute(
        month,
        count,
        currentMonth(),
      );
      const health = await this.container.getFinancialHealth.execute(currentMonth()).catch((e) => (console.error(e), null));
      if (seq !== this.loadSeq) return;
      this.report.set(report);
      this.health.set(health);
      this.categories.set(await this.container.categories.list());
      this.failed.set(false);
    } catch (error) {
      console.error(error);
      if (seq === this.loadSeq) this.failed.set(true);
    }
  }
}
