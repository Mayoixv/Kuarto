import { AppContainer } from '../../app.container';
import { CASH_ACCOUNT_ID } from '../../domain/account';
import { MonthKey } from '../../domain/month';
import { fileDate, saveBinaryFile } from '../file-io';
import { formatAccountMoney, formatDay, formatMoney, formatPercent, monthLabel } from '../format';
import { t } from '../i18n';

const MARGIN = 48;
const LINE = 16;

/**
 * PDF del mes: resumen, gasto por categoría y todos los movimientos.
 * jsPDF se carga solo al exportar, para no hacer más lenta la apertura de la app.
 */
export async function exportMonthPdf(container: AppContainer, month: MonthKey): Promise<string> {
  const [{ jsPDF }, overview, transactions, categories, accounts] = await Promise.all([
    import('jspdf'),
    container.getMonthOverview.execute(month),
    container.transactions.listByMonth(month),
    container.categories.list(),
    container.accounts.list(),
  ]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const width = doc.internal.pageSize.getWidth();
  const bottom = doc.internal.pageSize.getHeight() - MARGIN;
  let y = MARGIN;

  // Las fuentes estándar del PDF no traen el signo menos tipográfico ni la flecha: se usa el guion.
  const money = (cents: number) => formatMoney(cents).replace('−', '-');
  const ensure = (space: number) => {
    if (y + space > bottom) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const text = (value: string, x: number, opts: { size?: number; bold?: boolean; align?: 'left' | 'right'; color?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.color ?? 20);
    doc.text(value, x, y, { align: opts.align ?? 'left' });
  };
  const rule = () => {
    doc.setDrawColor(220);
    doc.line(MARGIN, y, width - MARGIN, y);
  };

  text('Kuarto', MARGIN, { size: 11, color: 110 });
  y += 26;
  text(monthLabel(month), MARGIN, { size: 22, bold: true });
  y += 30;

  const s = overview.summary;
  const summary: [string, string][] = [
    [t('inicio.income'), money(s.income)],
    [t('inicio.expenses'), money(s.expenses)],
    [t('inicio.saved'), money(s.saved)],
    [t('reports.balance'), money(s.balance)],
    [t('pdf.savingRate'), s.income > 0 ? `${formatPercent(s.savingsPercent)} (${t('inicio.rating.' + s.rating)})` : t('pdf.noIncome')],
  ];
  for (const [label, value] of summary) {
    text(label, MARGIN, { color: 90 });
    text(value, width - MARGIN, { align: 'right', bold: label === t('reports.balance') });
    y += LINE + 2;
  }

  y += 14;
  text(t('reports.byCategory'), MARGIN, { size: 13, bold: true });
  y += 18;
  if (overview.breakdown.length === 0) {
    text(t('pdf.noExpenses'), MARGIN, { color: 110 });
    y += LINE;
  }
  for (const slice of overview.breakdown) {
    ensure(LINE);
    text(slice.name, MARGIN);
    text(formatPercent(slice.percent), width - MARGIN - 110, { align: 'right', color: 110 });
    text(money(slice.amount), width - MARGIN, { align: 'right' });
    y += LINE;
  }

  y += 18;
  ensure(60);
  text(t('pdf.movements', { count: transactions.length }), MARGIN, { size: 13, bold: true });
  y += 18;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const showAccount = accounts.length > 1;
  const cols = { date: MARGIN, category: MARGIN + 52, note: MARGIN + 170, amount: width - MARGIN };
  text(t('pdf.date'), cols.date, { color: 110, size: 9 });
  text(t('pdf.category'), cols.category, { color: 110, size: 9 });
  text(showAccount ? t('pdf.noteAccount') : t('pdf.note'), cols.note, { color: 110, size: 9 });
  text(t('pdf.amount'), cols.amount, { color: 110, size: 9, align: 'right' });
  y += 6;
  rule();
  y += 14;
  doc.setFontSize(9);
  for (const tx of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    ensure(LINE);
    const category = byId.get(tx.categoryId);
    const income = category?.type === 'ingreso';
    const note = [tx.note, showAccount ? accountName.get(tx.accountId ?? CASH_ACCOUNT_ID) : ''].filter(Boolean).join(' · ');
    text(formatDay(tx.date), cols.date, { size: 9 });
    text(fit(doc, category?.name ?? t('common.noCategory'), 110), cols.category, { size: 9 });
    text(fit(doc, note, cols.amount - cols.note - 90), cols.note, { size: 9, color: 80 });
    const amount = formatAccountMoney(tx.amount, accountById.get(tx.accountId ?? CASH_ACCOUNT_ID)).replace('−', '-');
    text(`${income ? '+' : '-'}${amount}`, cols.amount, { size: 9, align: 'right' });
    y += LINE;
  }

  ensure(30);
  y += 14;
  text(t('pdf.generated', { date: formatDay(fileDate()) }), MARGIN, { size: 8, color: 140 });

  const base64 = doc.output('datauristring').split(',')[1];
  return saveBinaryFile(`kuarto-${month}.pdf`, base64, 'application/pdf');
}

/** Recorta un texto para que quepa en `max` puntos, con "…" si hace falta. */
function fit(doc: { getTextWidth(t: string): number }, value: string, max: number): string {
  if (doc.getTextWidth(value) <= max) return value;
  let out = value;
  while (out.length > 1 && doc.getTextWidth(out + '...') > max) out = out.slice(0, -1);
  return out + '...';
}
