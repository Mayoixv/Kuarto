import { CASH_ACCOUNT_ID } from '../../domain/account';
import { IsoDate } from '../../domain/month';
import { parseQuickEntry } from '../../domain/quick-entry';
import { Transaction } from '../../domain/transaction';
import { ValidationError } from '../errors';
import { IAccountRepository, ICategoryRepository, ISettingsRepository, ITransactionRepository } from '../ports/repositories';
import { AddTransaction } from './add-transaction';

/** Ajustes donde el formulario de movimientos recuerda la última cuenta y la última categoría de cada tipo. */
export const LAST_ACCOUNT_KEY = 'last_account';
export const lastCategoryKey = (kind: 'gasto' | 'ingreso') => `last_category_${kind}`;

/**
 * Gasto escrito de una vez, como "500 gasolina" (desde la notificación). Entiende la frase igual que el dictado y
 * lo guarda con el mismo caso de uso que el formulario. Si la frase no dice la categoría, usa la última de gasto
 * (o "Otros gastos"); la cuenta es la última usada, o Efectivo.
 */
export class AddQuickExpense {
  constructor(
    private readonly categories: ICategoryRepository,
    private readonly transactions: ITransactionRepository,
    private readonly accounts: IAccountRepository,
    private readonly settings: ISettingsRepository,
    private readonly addTransaction: AddTransaction,
  ) {}

  async execute(text: string, date: IsoDate): Promise<Transaction> {
    const all = await this.categories.list();
    const history = (await this.transactions.listAll())
      .filter((tx) => tx.note)
      .slice(-500)
      .map((tx) => ({ note: tx.note, categoryId: tx.categoryId }));
    const entry = parseQuickEntry(text, all, history);
    if (!entry.amount) throw new ValidationError('quickAmount');

    const expense = (id: string | null | undefined) => all.find((c) => c.id === id && c.type !== 'ingreso' && !c.hidden);
    const category =
      expense(entry.categoryId) ??
      expense(await this.settings.get(lastCategoryKey('gasto'))) ??
      expense('cat-otros-gastos') ??
      all.find((c) => c.type === 'variable' && !c.hidden);
    if (!category) throw new ValidationError('quickCategory');

    const last = await this.settings.get(LAST_ACCOUNT_KEY);
    const account = last ? await this.accounts.get(last) : undefined;
    const accountId = account && !account.archived ? account.id : CASH_ACCOUNT_ID;

    return this.addTransaction.execute({ date, amount: entry.amount, categoryId: category.id, note: entry.note, accountId });
  }
}
