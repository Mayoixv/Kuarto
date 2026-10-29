import { Component, inject, Input } from '@angular/core';
import { IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { helpCircle, sparkles } from 'ionicons/icons';
import { helpEntry, HelpTopic } from './help.content';
import { t } from '../i18n';

/** Hoja inferior corta con la ayuda de una pantalla (o las novedades de una versión). Se cierra al tocar fuera o con "Entendido"; no cambia nada. */
@Component({
  selector: 'app-help-sheet',
  template: `
    <div class="help">
      <div class="grab" aria-hidden="true"></div>
      <h2 class="title" id="help-title">
        <ion-icon [name]="news ? 'sparkles' : 'help-circle'" aria-hidden="true"></ion-icon>
        {{ entry.title }}
      </h2>
      <ul class="points" aria-labelledby="help-title">
        @for (p of entry.points; track $index; let i = $index) {
          <li [style.--i]="i">{{ p }}</li>
        }
      </ul>
      <button type="button" class="btn-primary ok" (click)="close()">{{ t('common.understood') }}</button>
    </div>
  `,
  styles: `
    /* Nunca más alta que la pantalla: título y botón quedan fijos y solo la lista se desplaza. */
    .help {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: calc(100dvh - var(--ion-safe-area-top, 0px) - 48px);
      padding: 8px 20px calc(var(--ion-safe-area-bottom, 0px) + 20px);
      background: var(--paper);
      color: var(--text-on-light);
    }
    .grab {
      width: 40px;
      height: 4px;
      margin: 4px auto 4px;
      border-radius: 2px;
      background: var(--line-axis);
    }
    .grab,
    .title,
    .ok {
      flex: none;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 19px;
      font-weight: 600;
    }
    .title ion-icon {
      color: var(--accent);
      font-size: 24px;
    }
    .points {
      flex: 0 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .points li {
      position: relative;
      padding-left: 20px;
      font-size: 16px;
      line-height: 1.45;
      animation: t-help-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
      animation-delay: calc(var(--i) * 50ms + 80ms);
    }
    .points li::before {
      content: '';
      position: absolute;
      left: 2px;
      top: 0.6em;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--violet-600);
    }
    .ok {
      margin-top: 4px;
    }
    @keyframes t-help-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .points li {
        animation: none;
      }
    }
  `,
  imports: [IonIcon],
})
export class HelpSheetComponent {
  protected readonly t = t;
  private readonly modalCtrl = inject(ModalController);
  @Input() topic: HelpTopic = 'inicio';
  /** En vez de la ayuda de una pantalla, las novedades de una versión (NewsService). */
  @Input() news?: { title: string; points: string[] };

  protected get entry() {
    return this.news ?? helpEntry(this.topic);
  }

  constructor() {
    addIcons({ helpCircle, sparkles });
  }

  protected close() {
    return this.modalCtrl.dismiss();
  }
}
