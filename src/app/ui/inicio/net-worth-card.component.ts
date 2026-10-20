import { Component, effect, inject, signal } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronForward } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { CardsToPay, NetWorth } from '../../application/use-cases/accounts';
import { formatMoney, todayIso } from '../format';
import { CardsToPaySheetComponent } from './cards-to-pay-sheet.component';
import { MonthState } from '../month-state';
import { t } from '../i18n';

/** Patrimonio en Inicio: una línea que lleva a la pestaña Dinero. */
@Component({
  selector: 'app-net-worth-card',
  template: `
    @if (net(); as n) {
      <div class="card">
      <button type="button" class="main" [attr.aria-label]="t('networth.open', { amount: money(n.total) })" (click)="open()">
        <span class="text">
          <span class="label">{{ t('networth.title') }}</span>
          <span class="amount">{{ money(n.total) }}</span>
          <span class="sub">{{ t('networth.available', { amount: money(n.available) }) }}@if (n.inGoals > 0) { · {{ t('networth.inGoals', { amount: money(n.inGoals) }) }}}@if (n.owedToMe > 0) { · {{ t('networth.owedToMe', { amount: money(n.owedToMe) }) }}} · {{ t('networth.owe', { amount: money(n.owe) }) }}</span>
        </span>
        <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
      </button>
      @if (toPay(); as p) {
        @let after = n.available - p.total;
        <div class="cards">
          <button type="button" class="row" (click)="openCards(p)">
            <span>{{ t('networth.cardsToPay') }}</span>
            <span class="value">{{ money(p.total) }}</span>
            <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
          </button>
          <p class="row">
            <span>{{ t('networth.afterCards') }}</span>
            <span class="value" [class.negative]="after < 0">{{ money(after) }}</span>
          </p>
        </div>
      }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      margin: 0 20px 24px;
      border: 1px solid var(--border-glow);
      border-radius: var(--radius-card);
      background: var(--ink-800);
      color: var(--text-on-dark);
      overflow: hidden;
    }
    .main {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 18px 20px;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .cards {
      display: flex;
      flex-direction: column;
      padding: 4px 20px 12px;
      border-top: 1px solid var(--border-glow);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 48px;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 15px;
      text-align: left;
    }
    button.row {
      cursor: pointer;
    }
    .row span:first-child {
      flex: 1;
      color: var(--muted);
    }
    .value {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .value.negative {
      color: var(--negative);
    }
    .main:focus-visible,
    .row:focus-visible {
      outline: 3px solid var(--violet-400);
      outline-offset: -3px;
    }
    .text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .label,
    .sub {
      font-size: 15px;
      color: var(--muted);
    }
    .amount {
      font-size: 22px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    ion-icon {
      flex: none;
      color: var(--muted);
    }
  `,
  imports: [IonIcon],
})
export class NetWorthCardComponent {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly router = inject(Router);
  private readonly monthState = inject(MonthState);

  private readonly modalCtrl = inject(ModalController);

  protected readonly net = signal<NetWorth | null>(null);
  /** Solo si hay algo por pagar de tarjetas. */
  protected readonly toPay = signal<CardsToPay | null>(null);
  protected readonly money = formatMoney;

  constructor() {
    addIcons({ chevronForward });
    effect(() => {
      this.monthState.version();
      Promise.all([this.container.getNetWorth.execute(), this.container.getCardsToPay.execute(todayIso())]).then(
        ([n, p]) => {
          this.net.set(n);
          this.toPay.set(p.total > 0 ? p : null);
        },
        (e) => console.error(e),
      );
    });
  }

  protected async openCards(data: CardsToPay) {
    const modal = await this.modalCtrl.create({ component: CardsToPaySheetComponent, componentProps: { data }, cssClass: 'select-modal' });
    await modal.present();
  }

  protected open() {
    this.router.navigateByUrl('/tabs/dinero');
  }
}
