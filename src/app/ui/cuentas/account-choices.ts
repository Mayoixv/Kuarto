import { AppContainer } from '../../app.container';
import { Account, CASH_ACCOUNT_ID } from '../../domain/account';
import { t } from '../i18n';
import { LAST_ACCOUNT_KEY } from '../../application/use-cases/quick-expense';

export const ACCOUNT_TYPES: Account['type'][] = ['efectivo', 'banco', 'ahorro', 'tarjeta', 'inversion'];
export const accountTypeLabel = (type: Account['type']) => t(`accountType.${type}`);

/** Etiqueta para elegir la cuenta: "Visa · Tarjeta de crédito". Efectivo va solo. */
/** Opciones para app-select-field. */
export const accountOptions = (accounts: Account[]) => accounts.map((a) => ({ value: a.id, label: accountLabel(a) }));

const SYMBOL = { DOP: 'RD$', USD: 'US$' } as const;

/** Las cuentas con moneda propia llevan su símbolo al final, para no confundirlas al elegir. */
export const accountLabel = (a: Account) =>
  (a.id === CASH_ACCOUNT_ID ? a.name : `${a.name} · ${accountTypeLabel(a.type)}`) + (a.currency ? ` · ${SYMBOL[a.currency]}` : '');

/**
 * Cuentas que se pueden elegir en un formulario (las activas, más la actual aunque esté archivada)
 * y cuál proponer: la actual, si no la última usada, si no Efectivo.
 */
export async function accountChoices(
  container: AppContainer,
  currentId?: string | null,
  /** Solo cuentas en la moneda principal: fijos, deudas y metas llevan sus montos en ella. */
  mainOnly = false,
): Promise<{ accounts: Account[]; selected: string }> {
  const [all, main] = await Promise.all([container.accounts.list(), container.currencySettings.get()]);
  const accounts = all.filter(
    (a) => (!a.archived || a.id === currentId) && (!mainOnly || !a.currency || a.currency === main || a.id === currentId),
  );
  const last = await container.settings.get(LAST_ACCOUNT_KEY);
  const usable = (id: string | null | undefined) => !!id && accounts.some((a) => a.id === id);
  const selected = usable(currentId) ? currentId! : usable(last) ? last! : CASH_ACCOUNT_ID;
  return { accounts, selected };
}

export function rememberAccount(container: AppContainer, id: string): Promise<void> {
  return container.settings.set(LAST_ACCOUNT_KEY, id);
}
