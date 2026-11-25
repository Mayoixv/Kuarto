import { CASH_ACCOUNT_ID, currencyOf } from '../../domain/account';
import { Currency } from '../../domain/currency';
import { IAccountRepository, ICategoryRepository, ITransactionRepository } from '../ports/repositories';

/** Comillas solo cuando hace falta (coma, comillas o salto de línea), como manda el CSV estándar. */
const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Todos los movimientos en CSV para Excel: UTF-8 con BOM para que respete los acentos. */
export class ExportTransactionsCsv {
  constructor(
    private readonly transactions: ITransactionRepository,
    private readonly categories: ICategoryRepository,
    private readonly accounts?: IAccountRepository,
    private readonly mainCurrency: () => Promise<Currency> = async () => 'DOP',
  ) {}

  /** Cada monto va en la moneda de su cuenta (columna moneda): no se convierte. */
  async execute(): Promise<{ csv: string; rows: number }> {
    const [transactions, categories, accounts, main] = await Promise.all([
      this.transactions.listAll(),
      this.categories.list(),
      this.accounts?.list() ?? [],
      this.mainCurrency(),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const lines = ['fecha,tipo,categoría,monto,nota,etiquetas,moneda'];
    for (const t of transactions) {
      const category = byId.get(t.categoryId);
      lines.push(
        [
          t.date,
          category?.type === 'ingreso' ? 'ingreso' : 'gasto',
          cell(category?.name ?? 'Sin categoría'),
          (t.amount / 100).toFixed(2),
          cell(t.note),
          cell((t.tags ?? []).join(', ')),
          currencyOf(accountById.get(t.accountId ?? CASH_ACCOUNT_ID), main),
        ].join(','),
      );
    }
    return { csv: '﻿' + lines.join('\r\n') + '\r\n', rows: transactions.length };
  }
}
