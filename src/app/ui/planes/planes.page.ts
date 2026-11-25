import { Component, computed, effect, inject, Injectable, input, signal } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { calculatorOutline } from 'ionicons/icons';
import { MetasViewComponent } from '../ahorro/metas-view.component';
import { DeudasViewComponent } from '../deudas/deudas-view.component';
import { HelpButtonComponent } from '../help/help-button.component';
import { MonthSwitcherComponent } from '../month-switcher.component';
import { PillOption, PillToggleComponent } from '../pill-toggle.component';
import { t } from '../i18n';

export type PlanesSection = 'metas' | 'deudas';
const SECTIONS: PlanesSection[] = ['metas', 'deudas'];

/** Sección visible de la pestaña Planes; el botón + agrega lo que corresponde a ella. */
@Injectable({ providedIn: 'root' })
export class PlanesState {
  readonly section = signal<PlanesSection>('metas');
}

/** Pestaña Planes: metas de ahorro y deudas, separadas de las cuentas (Dinero). */
@Component({
  selector: 'app-planes',
  template: `
    <ion-content class="surface-light" [fullscreen]="true">
      <header class="screen-head">
        <div class="title-row">
          <h1 class="screen-title">{{ t('planes.title') }}</h1>
          <app-help-button [topic]="state.section()"></app-help-button>
        </div>
        <app-month-switcher></app-month-switcher>
        <a routerLink="/calculadoras" class="tools-link">
          <ion-icon name="calculator-outline" aria-hidden="true"></ion-icon>
          {{ t('calc.open') }}
        </a>
      </header>

      <app-pill-toggle class="sections" [label]="t('planes.section')" [options]="options()" [value]="state.section()" (valueChange)="setSection($event)"></app-pill-toggle>

      <div class="section">
        @if (state.section() === 'metas') {
          <app-metas-view></app-metas-view>
        } @else {
          <app-deudas-view></app-deudas-view>
        }
      </div>
    </ion-content>
  `,
  styleUrls: ['../dinero/dinero.page.scss'],
  imports: [IonContent, IonIcon, RouterLink, HelpButtonComponent, MonthSwitcherComponent, PillToggleComponent, MetasViewComponent, DeudasViewComponent],
})
export class PlanesPage {
  protected readonly t = t;
  protected readonly state = inject(PlanesState);

  /** `?ver=deudas` en la dirección abre esa sección. */
  readonly ver = input<string>();

  protected readonly options = computed<PillOption[]>(() => SECTIONS.map((value) => ({ value, label: t(`planes.${value}`) })));

  constructor() {
    addIcons({ calculatorOutline });
    effect(() => {
      const ver = this.ver();
      if (ver && (SECTIONS as string[]).includes(ver)) this.state.section.set(ver as PlanesSection);
    });
  }

  protected setSection(value: string) {
    this.state.section.set(value as PlanesSection);
  }
}
