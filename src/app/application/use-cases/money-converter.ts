import { Account, CASH_ACCOUNT_ID } from '../../domain/account';
import { convertCents, Currency } from '../../domain/currency';
import { MonthKey } from '../../domain/month';
import { Attachment, Transaction } from '../../domain/transaction';
import { IAccountRepository, ITransactionRepository } from '../ports/repositories';
import { CurrencySettings } from './currency-settings';
import { GetExchangeRate } from './exchange-rate';

/**
 * Pasa montos de una cuenta a la moneda principal, para sumarlos con los demás (balance del mes, disponible,
 * patrimonio, reportes). Lo guardado nunca se convierte: cada movimiento sigue en la moneda de su cuenta.
 *
 * ponytail: usa la tasa del día también para meses pasados, así que sus totales se mueven un poco con la tasa.
 * Si hace falta exactitud histórica, guardar la tasa en cada movimiento (las transferencias ya la guardan).
 */
export class MoneyConverter {
  constructor(
    readonly main: Currency,
    /** Pesos por dólar; null si nunca se pudo consultar. */
    readonly usdToDop: number | null,
    private readonly accountCurrency: Map<string, Currency> = new Map(),
  ) {}

  /** Sin cuentas en otra moneda: no convierte nada. */
  static identity(main: Currency = 'DOP'): MoneyConverter {
    return new MoneyConverter(main, null);
  }

  /** Monto en `currency` (sin valor, la principal) pasado a la principal. Sin tasa no se puede: queda igual. */
  toMain(cents: number, currency?: Currency | null): number {
    if (!currency || currency === this.main || !this.usdToDop) return cents;
    return convertCents(cents, currency, this.usdToDop);
  }

  /** Monto de una cuenta (por id; sin id, Efectivo) en la moneda principal. */
  ofAccount(cents: number, accountId?: string | null): number {
    return this.toMain(cents, this.accountCurrency.get(accountId ?? CASH_ACCOUNT_ID));
  }

  /** Si la cuenta va en otra moneda que la principal. */
  isForeign(account: Pick<Account, 'currency'>): boolean {
    return !!account.currency && account.currency !== this.main;
  }

  /** El movimiento con sus montos (y los de sus divisiones) en la moneda principal. */
  transaction(t: Transaction): Transaction {
    const currency = this.accountCurrency.get(t.accountId ?? CASH_ACCOUNT_ID);
    if (!currency || currency === this.main || !this.usdToDop) return t;
    return {
      ...t,
      amount: this.ofAccount(t.amount, t.accountId),
      // Las partes se convierten por separado y la última absorbe el redondeo, para que sigan sumando el total.
      splits: t.splits?.map((s, i, all) =>
        i < all.length - 1
          ? { ...s, amount: this.ofAccount(s.amount, t.accountId) }
          : {
              ...s,
              amount:
                this.ofAccount(t.amount, t.accountId) -
                all.slice(0, -1).reduce((sum, p) => sum + this.ofAccount(p.amount, t.accountId), 0),
            },
      ),
    };
  }
}

export class LoadMoneyConverter {
  constructor(
    private readonly currency: CurrencySettings,
    private readonly accounts: IAccountRepository,
    private readonly rates: GetExchangeRate,
  ) {}

  /** Con la moneda principal, la última tasa guardada (sin conexión) y la moneda de cada cuenta. */
  async execute(): Promise<MoneyConverter> {
    const [main, rate, accounts] = await Promise.all([this.currency.get(), this.rates.cached(), this.accounts.list()]);
    const foreign = new Map(accounts.filter((a) => a.currency && a.currency !== main).map((a) => [a.id, a.currency!]));
    return new MoneyConverter(main, rate?.usdToDop ?? null, foreign);
  }
}

/**
 * Los movimientos con sus montos en la moneda principal. Lo usan solo los resúmenes; las listas y los formularios
 * leen el repositorio normal, con cada monto en la moneda de su cuenta.
 */
export class MainCurrencyTransactions implements ITransactionRepository {
  constructor(
    private readonly base: ITransactionRepository,
    private readonly converter: LoadMoneyConverter,
  ) {}

  async listByMonth(month: MonthKey): Promise<Transaction[]> {
    return this.convert(await this.base.listByMonth(month));
  }

  async listAll(): Promise<Transaction[]> {
    return this.convert(await this.base.listAll());
  }

  async get(id: string): Promise<Transaction | undefined> {
    const t = await this.base.get(id);
    return t && (await this.convert([t]))[0];
  }

  listAttachments(transactionId: string): Promise<Attachment[]> {
    return this.base.listAttachments(transactionId);
  }

  saveAttachment(attachment: Attachment): Promise<void> {
    return this.base.saveAttachment(attachment);
  }

  deleteAttachment(id: string): Promise<void> {
    return this.base.deleteAttachment(id);
  }

  /** Solo lectura: guardar un monto ya convertido lo cambiaría de moneda. */
  save(): Promise<void> {
    return Promise.reject(new Error('MainCurrencyTransactions is read-only'));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error('MainCurrencyTransactions is read-only'));
  }

  private async convert(list: Transaction[]): Promise<Transaction[]> {
    const c = await this.converter.execute();
    return list.map((t) => c.transaction(t));
  }
}
