import { Component, inject, Input } from '@angular/core';
import { IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cardOutline, close } from 'ionicons/icons';
import { CardsToPay } from '../../application/use-cases/accounts';
import { dueLabel, formatMoney, todayIso } from '../format';
import { t } from '../i18n';

/** Detalle de "Por pagar de tarjetas": cuánto de cada tarjeta, hasta qué fecha y cuántos días faltan. */
@Component({
  selector: 'app-cards-to-pay-sheet',
  template: `
    <div class="sheet-form">
      <div class="grab" aria-hidden="true"></div>
      <div class="head">
        <h2 class="title">{{ t('cardsToPay.title') }}</h2>
        <button type="button" class="close" [attr.aria-label]="t('common.close')" (click)="dismiss()">
          <ion-icon name="close" aria-hidden="true"></ion-icon>
        </button>
      </div>
      <p class="note">{{ t('cardsToPay.hint') }}</p>
      <ul class="list">
        @for (c of data.cards; track c.account.id) {
          <li class="item">
            <ion-icon name="card-outline" aria-hidden="true"></ion-icon>
            <div class="text">
              <span class="name">{{ c.account.name }}</span>
              @if (c.dueDate; as date) {
                @let due = label(date);
                <span class="when" [class.overdue]="due.overdue" [class.urgent]="due.urgent && !due.overdue">{{ due.text }}</span>
              } @else {
                <span class="when">{{ t('cardsToPay.noCut') }}</span>
              }
            </div>
            <span class="amount">{{ money(c.amount) }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .sheet-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 85vh;
      overflow-y: auto;
      background: var(--paper);
      padding: 8px 20px calc(var(--ion-safe-area-bottom, 0px) + 24px);
    }
    .grab {
      width: 40px;
      height: 4px;
      margin: 4px auto;
      border-radius: 2px;
      background: var(--line-axis);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .title {
      margin: 0;
      font-size: 19px;
      font-weight: 600;
      color: var(--text-on-light);
    }
    .close {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border: 0;
      border-radius: 50%;
      background: var(--surface-soft-chip);
      color: var(--text-on-light);
      font-size: 22px;
      cursor: pointer;
    }
    .note {
      margin: 0;
      font-size: 15px;
      line-height: 1.5;
      color: var(--muted-on-light);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-radius: var(--radius-field);
      background: var(--surface-soft-chip);
      color: var(--text-on-light);
    }
    .item ion-icon {
      flex: none;
      font-size: 22px;
      color: var(--accent);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .name {
      font-size: 16px;
      font-weight: 600;
    }
    .when {
      font-size: 14px;
      line-height: 1.4;
      color: var(--muted-on-light);
    }
    .when.urgent {
      color: var(--text-on-light);
      font-weight: 600;
    }
    .when.overdue {
      color: var(--overdue-on-light);
      font-weight: 600;
    }
    .amount {
      flex: none;
      font-size: 16px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
  imports: [IonIcon],
})
export class CardsToPaySheetComponent {
  private readonly modalCtrl = inject(ModalController);
  protected readonly t = t;
  protected readonly money = formatMoney;
  private readonly today = todayIso();

  @Input({ required: true }) data!: CardsToPay;

  constructor() {
    addIcons({ cardOutline, close });
  }

  protected label(date: string) {
    return dueLabel(date, this.today);
  }

  protected dismiss() {
    return this.modalCtrl.dismiss();
  }
}
