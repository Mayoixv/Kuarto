import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronForward } from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Account } from '../../domain/account';
import { Category } from '../../domain/category';
import { CategoryRule } from '../../domain/rules';
import { lookOf } from '../category-look';
import { MonthState } from '../month-state';
import { ReglaModalComponent } from './regla.modal';
import { HelpButtonComponent } from '../help/help-button.component';
import { t } from '../i18n';

interface Row {
  rule: CategoryRule;
  category: Category | undefined;
  detail: string;
}

/** Ajustes › Reglas: "si la nota contiene… va a…", para que los movimientos se ordenen solos. */
@Component({
  selector: 'app-reglas',
  template: `
    <ion-content class="surface-light" [fullscreen]="true">
      <header class="screen-head">
        <a routerLink="/ajustes/dinero" class="back" [attr.aria-label]="t('common.back', { to: t('ajustes.sections.dinero.title') })">
          <ion-icon name="chevron-back" aria-hidden="true"></ion-icon>
          {{ t('ajustes.sections.dinero.title') }}
        </a>
        <div class="title-row">
          <h1 class="screen-title">{{ t('reglas.title') }}</h1>
          <app-help-button topic="reglas"></app-help-button>
        </div>
      </header>

      <section class="block" [attr.aria-label]="t('reglas.title')">
        <p class="note">{{ t('reglas.note') }}</p>
        @if (failed()) {
          <p class="note">{{ t('reglas.failed') }}</p>
        } @else {
          <ul class="rows">
            @for (r of rows(); track r.rule.id) {
              <li>
                <button type="button" class="row" (click)="open(r.rule)">
                  <span class="cat-dot" [style.background]="look(r.category).color" aria-hidden="true">
                    <ion-icon [name]="look(r.category).icon"></ion-icon>
                  </span>
                  <span class="row-text">
                    <span class="row-title">{{ t('reglas.row', { match: r.rule.match }) }}</span>
                    <span class="row-sub">{{ r.detail }}</span>
                  </span>
                  <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon>
                </button>
              </li>
            } @empty {
              <li class="row-empty">{{ t('reglas.empty') }}</li>
            }
          </ul>
          <button type="button" class="btn-secondary add" (click)="open()">{{ t('reglas.add') }}</button>
        }
      </section>
    </ion-content>
  `,
  styleUrls: ['ajustes.page.scss'],
  imports: [RouterLink, IonContent, IonIcon, HelpButtonComponent],
})
export class ReglasPage {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modals = inject(ModalController);
  private readonly monthState = inject(MonthState);

  private readonly data = signal<{ rules: CategoryRule[]; categories: Category[]; accounts: Account[] } | null>(null);
  protected readonly failed = signal(false);
  private modalOpen = false;
  protected readonly look = (c: Category | undefined) => lookOf(c ?? { type: 'variable' });

  protected readonly rows = computed<Row[]>(() => {
    const d = this.data();
    if (!d) return [];
    const categories = new Map(d.categories.map((c) => [c.id, c]));
    const accounts = new Map(d.accounts.map((a) => [a.id, a.name]));
    return d.rules.map((rule) => {
      const category = categories.get(rule.categoryId);
      const parts = [category?.name ?? t('common.noCategory')];
      if (rule.accountId && accounts.has(rule.accountId)) parts.push(accounts.get(rule.accountId)!);
      if (rule.tag) parts.push('#' + rule.tag);
      return { rule, category, detail: parts.join(' · ') };
    });
  });

  constructor() {
    addIcons({ chevronBack, chevronForward });
    effect(() => {
      this.monthState.version();
      this.load();
    });
  }

  protected async open(rule?: CategoryRule) {
    if (this.modalOpen) return;
    this.modalOpen = true;
    try {
      const modal = await this.modals.create({ component: ReglaModalComponent, componentProps: { rule } });
      await modal.present();
      await modal.onWillDismiss();
      this.monthState.notifyChange();
    } finally {
      this.modalOpen = false;
    }
  }

  private async load() {
    try {
      const [rules, categories, accounts] = await Promise.all([
        this.container.rules.list(),
        this.container.categories.list(),
        this.container.accounts.list(),
      ]);
      this.data.set({ rules, categories, accounts });
      this.failed.set(false);
    } catch (error) {
      console.error(error);
      this.failed.set(true);
    }
  }
}
