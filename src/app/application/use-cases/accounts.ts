import { Account, AccountType, ADJUST_ACCOUNT_ID, CASH_ACCOUNT_ID, dueDateAfter, isCard, lastCutDate, Transfer } from '../../domain/account';
import { isValidCents } from '../../domain/money';
import { daysBetween, IsoDate, isValidIsoDate } from '../../domain/month';
import { DebtDirection } from '../../domain/debts';
import { NotFoundError, ValidationError } from '../errors';
import { GetDebtsOverview } from './debts';
import { IAccountRepository, IdGenerator, ISavingsRepository, ISettingsRepository } from '../ports/repositories';
import { signedAmount } from '../../domain/savings';

const TYPES: AccountType[] = ['efectivo', 'banco', 'ahorro', 'tarjeta', 'inversion'];

export interface AccountFields {
  name: string;
  type: AccountType;
  initialBalance: number;
  creditLimit?: number | null;
  cutDay?: number | null;
  dueDay?: number | null;
  /** Últimos 4 dígitos de la tarjeta, para reconocerla (se muestran en la tarjeta de crédito). */
  cardLast4?: string | null;
}

const validDay = (d: number | null | undefined) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 31;

export class SaveAccount {
  constructor(
    private readonly accounts: IAccountRepository,
    private readonly ids: IdGenerator,
  ) {}

  /** Crea una cuenta, o la edita si llega `id`. Los datos de tarjeta solo se guardan en tarjetas. */
  async execute(input: AccountFields, id?: string): Promise<Account> {
    const current = id ? await this.accounts.get(id) : undefined;
    if (id && !current) throw new NotFoundError('account');
    const name = input.name.trim();
    if (!name) throw new ValidationError('accountName');
    if (!TYPES.includes(input.type)) throw new ValidationError('accountType');
    if (!Number.isInteger(input.initialBalance)) throw new ValidationError('initialBalance');
    if (id === CASH_ACCOUNT_ID && input.type !== 'efectivo') throw new ValidationError('cashType');
    const last4 = input.cardLast4?.trim() || null;
    if (last4 && !/^\d{4}$/.test(last4)) throw new ValidationError('cardLast4');
    if (last4 && (await this.accounts.list()).some((a) => a.id !== id && a.cardLast4 === last4)) {
      throw new ValidationError('cardLast4Taken');
    }
    const card = isCard(input);
    if (card) {
      if (!isValidCents(input.creditLimit ?? 0)) throw new ValidationError('cardLimit');
      if (!validDay(input.cutDay)) throw new ValidationError('cutDay');
      if (!validDay(input.dueDay)) throw new ValidationError('payDay');
    }
    const account: Account = {
      id: id ?? this.ids.next(),
      name,
      type: input.type,
      initialBalance: input.initialBalance,
      creditLimit: card ? input.creditLimit : null,
      cutDay: card ? input.cutDay : null,
      dueDay: card ? input.dueDay : null,
      archived: current?.archived ?? false,
      cardLast4: input.type === 'efectivo' ? null : last4,
    };
    await this.accounts.save(account);
    return account;
  }
}

export class ArchiveAccount {
  constructor(private readonly accounts: IAccountRepository) {}

  async execute(id: string, archived: boolean): Promise<void> {
    if (id === CASH_ACCOUNT_ID && archived) throw new ValidationError('cashArchive');
    const account = await this.accounts.get(id);
    if (!account) throw new NotFoundError('account');
    await this.accounts.save({ ...account, archived });
  }
}

export class DeleteAccount {
  constructor(private readonly accounts: IAccountRepository) {}

  /** Solo cuentas sin historial; las que tienen movimientos se archivan para no perderlos. */
  async execute(id: string): Promise<void> {
    if (id === CASH_ACCOUNT_ID) throw new ValidationError('cashDelete');
    if (await this.accounts.isInUse(id)) {
      throw new ValidationError('accountHasMovements');
    }
    await this.accounts.delete(id);
  }
}

export class AdjustAccountBalance {
  constructor(
    private readonly accounts: IAccountRepository,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Hace que el saldo calculado sea el real. Con `date` deja el ajuste como una transferencia con la cuenta interna
   * de ajustes (se ve en Movimientos y no cuenta como ingreso ni gasto). Sin fecha, al crear la cuenta en la
   * bienvenida, cambia el saldo inicial.
   */
  async execute(id: string, realBalance: number, date?: IsoDate): Promise<Transfer | undefined> {
    if (!Number.isInteger(realBalance)) throw new ValidationError('balance');
    if (date !== undefined && !isValidIsoDate(date)) throw new ValidationError('date');
    const account = await this.accounts.get(id);
    if (!account || id === ADJUST_ACCOUNT_ID) throw new NotFoundError('account');
    const current = (await this.accounts.balances()).get(id) ?? account.initialBalance;
    const diff = realBalance - current;
    if (diff === 0) return undefined;
    if (date === undefined) {
      await this.accounts.save({ ...account, initialBalance: account.initialBalance + diff });
      return undefined;
    }
    const transfer: Transfer = {
      id: this.ids.next(),
      date,
      amount: Math.abs(diff),
      fromAccountId: diff > 0 ? ADJUST_ACCOUNT_ID : id,
      toAccountId: diff > 0 ? id : ADJUST_ACCOUNT_ID,
      note: '',
    };
    await this.accounts.saveTransfer(transfer);
    return transfer;
  }
}

export interface AccountView {
  account: Account;
  balance: number;
}

export interface AccountsOverview {
  accounts: AccountView[];
  /** Lo que tienes: suma de las cuentas que no son tarjetas. */
  assets: number;
  /** Lo que debes en tarjetas (positivo). */
  cardDebt: number;
}

export class GetAccountsOverview {
  constructor(private readonly accounts: IAccountRepository) {}

  async execute(): Promise<AccountsOverview> {
    const [accounts, balances] = await Promise.all([this.accounts.list(), this.accounts.balances()]);
    const views = accounts.map((account) => ({ account, balance: balances.get(account.id) ?? account.initialBalance }));
    const active = views.filter((v) => !v.account.archived || v.balance !== 0);
    return {
      accounts: views,
      assets: active.filter((v) => !isCard(v.account)).reduce((s, v) => s + v.balance, 0),
      cardDebt: active.filter((v) => isCard(v.account)).reduce((s, v) => s + Math.max(0, -v.balance), 0),
    };
  }
}

export interface TransferFields {
  date: string;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  note?: string;
}

export class SaveTransfer {
  constructor(
    private readonly accounts: IAccountRepository,
    private readonly ids: IdGenerator,
  ) {}

  /** Crea una transferencia, o la edita si llega `id`. */
  async execute(input: TransferFields, id?: string): Promise<Transfer> {
    if (id && !(await this.accounts.getTransfer(id))) throw new NotFoundError('transfer');
    if (!isValidCents(input.amount)) throw new ValidationError('amountPositive');
    if (!isValidIsoDate(input.date)) throw new ValidationError('date');
    if (input.fromAccountId === input.toAccountId) throw new ValidationError('sameAccounts');
    for (const accountId of [input.fromAccountId, input.toAccountId]) {
      if (!(await this.accounts.get(accountId))) throw new NotFoundError('account');
    }
    const transfer: Transfer = {
      id: id ?? this.ids.next(),
      date: input.date,
      amount: input.amount,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      note: input.note?.trim() ?? '',
    };
    await this.accounts.saveTransfer(transfer);
    return transfer;
  }
}

export class DeleteTransfer {
  constructor(private readonly accounts: IAccountRepository) {}

  /** Devuelve la transferencia borrada para poder deshacer. */
  async execute(id: string): Promise<Transfer | undefined> {
    const transfer = await this.accounts.getTransfer(id);
    if (transfer) await this.accounts.deleteTransfer(id);
    return transfer;
  }
}

export interface CardStatus {
  account: Account;
  /** Fecha del último corte y fecha límite para pagar ese estado. */
  lastCut: IsoDate;
  dueDate: IsoDate;
  /** Días hasta la fecha de pago (negativo si ya pasó). */
  daysToDue: number;
  /** Lo que se debía al cortar. */
  statementDebt: number;
  /** Pagos hechos a la tarjeta desde el corte. */
  paidSinceCut: number;
  /** Lo que falta pagar del estado para no pagar intereses. */
  pending: number;
  /** Compras y cargos desde el corte (irán al próximo estado). */
  cycleCharges: number;
  currentDebt: number;
  /** Porcentaje del límite usado; null si no tiene límite. */
  utilization: number | null;
  /** Pago mínimo de este estado, si el usuario lo anotó (lo fija cada banco). */
  minimum: number | null;
}

/**
 * Clave del pago mínimo de una tarjeta para el estado que cortó en `cut`.
 * ponytail: una fila de ajustes por tarjeta y mes que no se borra (unas 12 al año por tarjeta); si crece, pasar a
 * una columna de la tabla de cuentas con una migración.
 */
const minimumKey = (accountId: string, cut: IsoDate) => `card_min:${accountId}:${cut}`;

export class SetCardMinimum {
  constructor(private readonly settings: ISettingsRepository) {}

  /** Guarda (o borra, con null) el pago mínimo del estado que cortó en `cut`. */
  async execute(accountId: string, cut: IsoDate, amount: number | null): Promise<void> {
    if (amount !== null && !isValidCents(amount)) throw new ValidationError('minPayment');
    await this.settings.set(minimumKey(accountId, cut), amount === null ? '' : String(amount));
  }
}

export class GetCardStatuses {
  constructor(
    private readonly accounts: IAccountRepository,
    private readonly settings: ISettingsRepository,
  ) {}

  /** Estado de cada tarjeta activa con días de corte y pago. */
  async execute(today: IsoDate): Promise<CardStatus[]> {
    const cards = (await this.accounts.list()).filter((a) => isCard(a) && !a.archived && a.cutDay && a.dueDay);
    if (cards.length === 0) return [];
    const [now, transfers] = await Promise.all([this.accounts.balances(today), this.accounts.listTransfers()]);
    const cuts = cards.map((a) => lastCutDate(a.cutDay!, today));
    const [atCuts, minimums] = await Promise.all([
      Promise.all(cuts.map((cut) => this.accounts.balances(cut))),
      Promise.all(cards.map((a, i) => this.settings.get(minimumKey(a.id, cuts[i])))),
    ]);
    const out: CardStatus[] = [];
    for (const [i, account] of cards.entries()) {
      const lastCut = cuts[i];
      const dueDate = dueDateAfter(lastCut, account.dueDay!);
      const atCut = atCuts[i].get(account.id) ?? account.initialBalance;
      const statementDebt = Math.max(0, -atCut);
      const currentDebt = Math.max(0, -(now.get(account.id) ?? account.initialBalance));
      const paidSinceCut = transfers
        .filter((t) => t.toAccountId === account.id && t.date > lastCut && t.date <= today)
        .reduce((s, t) => s + t.amount, 0);
      out.push({
        account,
        lastCut,
        dueDate,
        daysToDue: daysBetween(today, dueDate),
        statementDebt,
        paidSinceCut,
        pending: Math.max(0, statementDebt - paidSinceCut),
        cycleCharges: Math.max(0, currentDebt - statementDebt + paidSinceCut),
        currentDebt,
        utilization: account.creditLimit ? (currentDebt / account.creditLimit) * 100 : null,
        minimum: Number(minimums[i] || 0) || null,
      });
    }
    return out;
  }
}

export interface CardToPay {
  account: Account;
  /** Lo que falta pagar del último estado; sin corte configurado, toda la deuda. */
  amount: number;
  /** null si la tarjeta no tiene días de corte y pago. */
  dueDate: IsoDate | null;
  daysToDue: number | null;
}

export interface CardsToPay {
  total: number;
  cards: CardToPay[];
}

/**
 * Lo que hay que pagar de las tarjetas activas: lo pendiente del último estado (las compras después del corte van al
 * próximo). Al pagar, esto baja lo mismo que baja el disponible, así que "disponible − por pagar" no cambia.
 */
export class GetCardsToPay {
  constructor(
    private readonly accounts: GetAccountsOverview,
    private readonly statuses: GetCardStatuses,
  ) {}

  async execute(today: IsoDate): Promise<CardsToPay> {
    const [overview, statuses] = await Promise.all([this.accounts.execute(), this.statuses.execute(today)]);
    const byId = new Map(statuses.map((s) => [s.account.id, s]));
    const cards = overview.accounts
      .filter((v) => isCard(v.account) && !v.account.archived)
      .map((v): CardToPay => {
        const s = byId.get(v.account.id);
        return s
          ? { account: v.account, amount: s.pending, dueDate: s.dueDate, daysToDue: s.daysToDue }
          : { account: v.account, amount: Math.max(0, -v.balance), dueDate: null, daysToDue: null };
      })
      .filter((c) => c.amount > 0);
    return { total: cards.reduce((s, c) => s + c.amount, 0), cards };
  }
}

export interface NetWorth {
  /** Disponible: saldo de cuentas y efectivo, sin tarjetas. Lo que te deben no cuenta: todavía no se puede usar. */
  available: number;
  /** Lo que te deben (deudas "me deben" pendientes). */
  owedToMe: number;
  /** Lo que salió de tus cuentas hacia metas: sigue siendo tuyo. Los aportes sin cuenta (anteriores) no cuentan. */
  inGoals: number;
  /** available + owedToMe + inGoals. */
  have: number;
  /** Lo que debes: tarjetas más deudas. */
  owe: number;
  /** have − owe. */
  total: number;
}

/** Patrimonio: cuentas − tarjetas − deudas + préstamos hechos a otros. */
export class GetNetWorth {
  constructor(
    private readonly accounts: GetAccountsOverview,
    private readonly debts: GetDebtsOverview,
    private readonly savings?: ISavingsRepository,
  ) {}

  async execute(): Promise<NetWorth> {
    const [accounts, debts, contributions] = await Promise.all([
      this.accounts.execute(),
      this.debts.execute(),
      this.savings?.listContributions() ?? [],
    ]);
    const inGoals = contributions.filter((c) => c.accountId).reduce((s, c) => s + signedAmount(c), 0);
    const sum = (dir: DebtDirection) => debts.filter((d) => d.debt.direction === dir).reduce((s, d) => s + Math.max(0, d.balance), 0);
    const owedToMe = sum('me_deben');
    const have = accounts.assets + owedToMe + inGoals;
    const owe = accounts.cardDebt + sum('debo');
    return { available: accounts.assets, owedToMe, inGoals, have, owe, total: have - owe };
  }
}
