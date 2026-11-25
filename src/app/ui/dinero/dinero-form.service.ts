import { inject, Injectable } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { AccountView } from '../../application/use-cases/accounts';
import { Account, AccountType, adjustmentOf, Transfer } from '../../domain/account';
import { APP_CONTAINER } from '../../app.container';
import { formatAccountMoney, formatDay } from '../format';
import { t } from '../i18n';
import { CuentaModalComponent } from '../cuentas/cuenta.modal';
import { TransferenciaModalComponent } from '../cuentas/transferencia.modal';
import { MonthState } from '../month-state';

type Currencies = Map<string, Pick<Account, 'currency'>>;

/** Título e importe con signo de un ajuste de saldo; null si es una transferencia normal. */
export function adjustmentText(
  transfer: Transfer,
  names: Map<string, string>,
  accounts: Currencies = new Map(),
): { title: string; amount: string } | null {
  const adj = adjustmentOf(transfer);
  if (!adj) return null;
  return {
    title: t('adjust.row', { account: names.get(adj.accountId) ?? t('cuentas.account') }),
    amount: (adj.amount > 0 ? '+' : '') + formatAccountMoney(adj.amount, accounts.get(adj.accountId)),
  };
}

/** Importe de una transferencia, en la moneda de la cuenta de origen. */
export function transferAmountText(transfer: Transfer, accounts: Currencies): string {
  return formatAccountMoney(transfer.amount, accounts.get(transfer.fromAccountId));
}

/**
 * Entre monedas, lo que llegó ("Llegó US$10.00"), para la línea de abajo: junto al monto no cabía y cortaba el
 * nombre de las cuentas. null si las dos cuentas van en la misma moneda.
 */
export function transferArrivedText(transfer: Transfer, accounts: Currencies): string | null {
  return transfer.toAmount ? t('transfer.arrived', { amount: formatAccountMoney(transfer.toAmount, accounts.get(transfer.toAccountId)) }) : null;
}

/** Abre los formularios de la pestaña Dinero (cuentas, tarjetas, transferencias, deudas) y recarga al cerrarse. */
@Injectable({ providedIn: 'root' })
export class DineroFormService {
  private readonly modals = inject(ModalController);
  private readonly monthState = inject(MonthState);
  private readonly alerts = inject(AlertController);
  private readonly container = inject(APP_CONTAINER);
  private isOpen = false;

  openAccount(view?: AccountView, presetType?: AccountType) {
    return this.open(CuentaModalComponent, { view, presetType });
  }

  openTransfer(toAccountId?: string, suggestedAmount?: number) {
    return this.open(TransferenciaModalComponent, { toAccountId, suggestedAmount });
  }

  editTransfer(transfer: Transfer) {
    return adjustmentOf(transfer) ? this.showAdjustment(transfer) : this.open(TransferenciaModalComponent, { transfer });
  }

  /** Un ajuste de saldo se puede ver y borrar (con confirmación), pero no editar su monto. */
  private async showAdjustment(transfer: Transfer) {
    if (this.isOpen) return;
    this.isOpen = true;
    try {
      const accounts = await this.container.accounts.list();
      const names = new Map(accounts.map((a) => [a.id, a.name]));
      const text = adjustmentText(transfer, names, new Map(accounts.map((a) => [a.id, a])))!;
      const ask = async (header: string, message: string, ok: string) => {
        const alert = await this.alerts.create({
          cssClass: 'app-alert',
          header,
          message,
          buttons: [
            { text: t('common.cancel'), role: 'cancel' },
            { text: ok, role: 'destructive' },
          ],
        });
        await alert.present();
        return (await alert.onDidDismiss()).role === 'destructive';
      };
      if (!(await ask(t('adjust.title'), t('adjust.detail', { title: text.title, amount: text.amount, date: formatDay(transfer.date) }), t('adjust.delete')))) return;
      if (!(await ask(t('adjust.delete'), t('adjust.confirm'), t('common.delete')))) return;
      await this.container.deleteTransfer.execute(transfer.id);
      this.monthState.notifyChange();
    } finally {
      this.isOpen = false;
    }
  }

  async open(component: unknown, componentProps: Record<string, unknown>) {
    // Un doble toque no debe abrir dos formularios.
    if (this.isOpen) return;
    this.isOpen = true;
    try {
      const modal = await this.modals.create({ component: component as never, componentProps });
      await modal.present();
      await modal.onWillDismiss();
      this.monthState.notifyChange();
    } finally {
      this.isOpen = false;
    }
  }
}
