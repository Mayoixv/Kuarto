import { FinancialHealth, financialHealth } from '../../domain/financial-health';
import { addMonths, MonthKey } from '../../domain/month';
import { GetAccountsOverview } from './accounts';
import { GetDebtsOverview } from './debts';
import { GetMonthHistory } from './get-month-history';

/** Meses completos que se promedian. */
const MONTHS = 3;

/** Indicadores de salud financiera con los últimos meses completos antes de `currentMonth`. */
export class GetFinancialHealth {
  constructor(
    private readonly history: GetMonthHistory,
    private readonly accounts: GetAccountsOverview,
    private readonly debts: GetDebtsOverview,
  ) {}

  async execute(currentMonth: MonthKey): Promise<FinancialHealth> {
    const [history, overview, debts] = await Promise.all([
      this.history.execute(addMonths(currentMonth, -1), MONTHS),
      this.accounts.execute(),
      this.debts.execute(),
    ]);
    const monthlyDebt = debts
      .filter((d) => d.debt.direction === 'debo' && d.balance > 0)
      .reduce((s, d) => s + d.installment, 0);
    return financialHealth({ available: overview.assets, history, monthlyDebt });
  }
}
