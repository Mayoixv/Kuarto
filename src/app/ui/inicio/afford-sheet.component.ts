import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { IonIcon, IonInput, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircle, checkmarkCircle, close, timeOutline } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { AffordAnswer } from '../../application/use-cases/can-afford';
import { formatDay, formatMoney, parseAmount, todayIso } from '../format';
import { t, tn } from '../i18n';

const ICONS = { si: 'checkmark-circle', justo: 'alert-circle', espera: 'time-outline', no: 'alert-circle' };

/** "¿Me alcanza?": escribe un monto y responde con el dinero del mes y, más abajo, contando todo el patrimonio. */
@Component({
  selector: 'app-afford-sheet',
  template: `
    <div class="sheet-form">
      <div class="grab" aria-hidden="true"></div>
      <div class="head">
        <h2 class="title">{{ t('afford.title') }}</h2>
        <button type="button" class="close" [attr.aria-label]="t('common.close')" (click)="dismiss()">
          <ion-icon name="close" aria-hidden="true"></ion-icon>
        </button>
      </div>
      <div class="field">
        <ion-input
          [label]="t('afford.label')"
          label-placement="floating"
          inputmode="decimal"
          [autofocus]="true"
          (ionInput)="check($event.detail.value ?? '')"
        ></ion-input>
      </div>
      <div aria-live="polite">
        @if (result(); as a) {
          @let r = a.month;
          <p class="eyebrow">{{ t('afford.monthTitle') }}</p>
          <div class="verdict" [class]="'verdict ' + r.verdict">
            <ion-icon [name]="icons[r.verdict]" aria-hidden="true"></ion-icon>
            <div>
              <p class="answer">{{ t('afford.verdict.' + r.verdict, { date: r.waitUntil ? day(r.waitUntil) : '' }) }}</p>
              <p class="detail">
                @if (r.left >= 0) {
                  {{ t('afford.left', { amount: money(r.left) }) }}
                  {{ tn('afford.perDay', r.days, { amount: money(r.perDay) }) }}
                } @else {
                  {{ t('afford.short', { amount: money(-r.left) }) }}
                  @if (r.verdict === 'espera') {
                    {{ t('afford.waitSub') }}
                  }
                }
                <ng-container *ngTemplateOutlet="dip; context: { $implicit: r }" />
              </p>
            </div>
          </div>
          <p class="eyebrow">{{ t('afford.totalTitle') }}</p>
          <div class="verdict total" [class]="'verdict total ' + a.total.verdict">
            <ion-icon [name]="icons[a.total.verdict]" aria-hidden="true"></ion-icon>
            <div>
              <p class="answer">{{ t('afford.verdict.' + a.total.verdict, { date: a.total.waitUntil ? day(a.total.waitUntil) : '' }) }}</p>
              <p class="detail">
                {{ a.total.left >= 0 ? t('afford.totalLeft', { amount: money(a.total.left) }) : t('afford.short', { amount: money(-a.total.left) }) }}
                <ng-container *ngTemplateOutlet="dip; context: { $implicit: a.total }" />
              </p>
            </div>
          </div>
          @if (r.pending > 0) {
            <p class="note">{{ t('afford.pending', { amount: money(r.pending) }) }}</p>
          }
        } @else {
          <p class="note">{{ t('afford.hint') }}</p>
        }
      </div>
    </div>
    <!-- El bache del mes: qué día y qué pago dejan corto, o el punto más bajo si nunca llega a faltar. -->
    <ng-template #dip let-r>
      @if (r.bottleneck; as b) {
        {{ b.label ? t('afford.bottleneck', { date: day(b.date), label: b.label }) : t('afford.bottleneckSpending', { date: day(b.date) }) }}
      } @else if (r.lowest < r.left) {
        {{ t('afford.lowest', { amount: money(r.lowest), date: day(r.lowestDate) }) }}
      }
    </ng-template>
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
    .field {
      min-height: 60px;
      padding: 0 16px;
      border: 1.5px solid transparent;
      border-radius: var(--radius-field);
      background: var(--surface-soft-chip);
      --color: var(--text-on-light);
      --placeholder-color: var(--muted-on-light);
      font-size: 18px;
    }
    .field:focus-within {
      border-color: var(--accent);
    }
    .verdict {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-radius: var(--radius-field);
      background: var(--surface-soft-chip);
      color: var(--text-on-light);
    }
    .eyebrow {
      margin: 0 0 -8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted-on-light);
    }
    .total {
      padding: 12px 16px;
    }
    .total .answer {
      font-size: 16px;
    }
    .total ion-icon {
      font-size: 22px;
    }
    .verdict ion-icon {
      flex: none;
      font-size: 28px;
    }
    .si ion-icon {
      color: var(--positive-on-light);
    }
    .justo ion-icon,
    .espera ion-icon {
      color: var(--accent);
    }
    .no ion-icon {
      color: var(--negative-on-light);
    }
    .answer {
      margin: 0 0 4px;
      font-size: 18px;
      font-weight: 600;
    }
    .detail,
    .note {
      margin: 0;
      font-size: 15px;
      line-height: 1.5;
      color: var(--muted-on-light);
    }
  `,
  imports: [IonIcon, IonInput, NgTemplateOutlet],
})
export class AffordSheetComponent {
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  protected readonly t = t;
  protected readonly tn = tn;
  protected readonly money = formatMoney;
  protected readonly day = formatDay;
  protected readonly icons = ICONS;
  protected readonly result = signal<AffordAnswer | null>(null);
  private seq = 0;

  constructor() {
    addIcons({ alertCircle, checkmarkCircle, close, timeOutline });
  }

  protected async check(text: string) {
    const seq = ++this.seq;
    const amount = parseAmount(text);
    const result = amount === null ? null : await this.container.canAfford.execute(amount, todayIso());
    if (seq === this.seq) this.result.set(result);
  }

  protected dismiss() {
    return this.modalCtrl.dismiss();
  }
}
