import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { HelpButtonComponent } from '../help/help-button.component';
import { lookOf } from '../category-look';
import {
  AlertController,
  IonContent,
  IonIcon,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  attachOutline,
  checkmark,
  chevronDown,
  copyOutline,
  createOutline,
  ellipsisHorizontal,
  searchOutline,
  swapHorizontal,
  trashOutline,
} from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { DeletedTransaction } from '../../application/use-cases/delete-transaction';
import { Account, CASH_ACCOUNT_ID, Transfer } from '../../domain/account';
import { Category, isExpenseType } from '../../domain/category';
import { adjustmentText, DineroFormService } from '../dinero/dinero-form.service';
import { Transaction } from '../../domain/transaction';
import { formatDay, formatMoney } from '../format';
import { DropdownComponent } from '../dropdown.component';
import { MonthSwitcherComponent } from '../month-switcher.component';
import { MonthState } from '../month-state';
import { PillOption, PillToggleComponent } from '../pill-toggle.component';
import { UndoService } from '../undo.service';
import { TransactionFormService } from './transaction-form.service';
import { LoadingComponent } from '../loading.component';
import { t, tn, locale } from '../i18n';
import { CopiarModalComponent } from './copiar.modal';

/** Alto aproximado del menú de 3 opciones y espacio que ocupan la barra inferior y el botón +. */
const MENU_HEIGHT = 170;
const BOTTOM_BAR_SPACE = 100;

interface Row {
  id: string;
  transaction: Transaction;
  /** Ícono y color de la categoría, para el círculo de la fila. */
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  amount: string;
  isIncome: boolean;
  tags: string[];
  hasPhotos: boolean;
  categoryIds: string[];
  /** Texto en minúsculas y sin acentos para buscar: nota, categorías y etiquetas. */
  haystack: string;
}

/** "Café" y "cafe" deben coincidir al buscar. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();

@Component({
  selector: 'app-movimientos',
  templateUrl: 'movimientos.page.html',
  styleUrls: ['movimientos.page.scss'],
  imports: [HelpButtonComponent, 
    LoadingComponent,
    IonContent,
    IonIcon,
    MonthSwitcherComponent,
    DropdownComponent,
    PillToggleComponent,
  ],
})
export class MovimientosPage {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  protected readonly monthState = inject(MonthState);
  private readonly form = inject(TransactionFormService);
  private readonly alerts = inject(AlertController);
  private readonly toasts = inject(ToastController);
  private readonly undo = inject(UndoService);
  private readonly dineroForm = inject(DineroFormService);
  private readonly modals = inject(ModalController);
  protected readonly headMenuOpen = signal(false);

  /** `?categoria=<id>` en la dirección (desde Reportes) deja puesto ese filtro. */
  readonly categoria = input<string>();

  protected readonly rows = signal<Row[] | null>(null);
  private readonly categories = signal<Category[]>([]);
  protected readonly failed = signal(false);
  /** Fila con el menú "⋯" abierto, y si se abre hacia arriba porque abajo no cabe. */
  protected readonly menuFor = signal<string | null>(null);
  protected readonly menuUp = signal(false);
  protected readonly liveMessage = signal('');
  /** Cada carga lleva un número; si el usuario cambió de mes mientras tanto, la respuesta vieja se descarta. */
  private loadSeq = 0;

  // Búsqueda y filtros (solo cambian la lista, no el resumen de Inicio).
  protected readonly search = signal('');
  protected readonly kindFilter = signal('todos');
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly categoryMenuOpen = signal(false);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly accountFilter = signal<string | null>(null);
  protected readonly accountMenuOpen = signal(false);
  private readonly transfers = signal<Transfer[]>([]);
  protected readonly kindOptions = computed<PillOption[]>(() =>
    ['todos', 'gasto', 'ingreso'].map((value) => ({ value, label: t(`movs.kinds.${value}`) })),
  );

  // Selección para edición masiva.
  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  /** Categorías que aparecen este mes, para el filtro. */
  protected readonly monthCategories = computed(() => {
    const used = new Set((this.rows() ?? []).flatMap((r) => r.categoryIds));
    return this.categories()
      .filter((c) => used.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, locale()));
  });

  protected readonly categoryFilterLabel = computed(
    () =>
      this.categories().find((c) => c.id === this.categoryFilter())?.name ??
      t('movs.allCategories'),
  );

  protected readonly accountFilterLabel = computed(
    () =>
      this.accounts().find((a) => a.id === this.accountFilter())?.name ??
      t('movs.allAccounts'),
  );

  protected readonly filtering = computed(
    () =>
      !!this.search().trim() ||
      this.kindFilter() !== 'todos' ||
      !!this.categoryFilter() ||
      !!this.accountFilter(),
  );

  /** Transferencias del mes: no son gasto ni ingreso, así que solo se ven sin filtro de tipo ni de categoría. */
  protected readonly visibleTransfers = computed(() => {
    if (this.kindFilter() !== 'todos' || this.categoryFilter()) return [];
    const names = new Map(this.accounts().map((a) => [a.id, a.name]));
    const account = this.accountFilter();
    const words = fold(this.search()).split(/\s+/).filter(Boolean);
    return this.transfers()
      .filter(
        (tr) =>
          !account || tr.fromAccountId === account || tr.toAccountId === account,
      )
      .map((tr) => {
        const adjustment = adjustmentText(tr, names);
        const title = adjustment?.title ?? `${names.get(tr.fromAccountId) ?? t('cuentas.account')} → ${names.get(tr.toAccountId) ?? t('cuentas.account')}`;
        return {
          transfer: tr,
          adjustment: !!adjustment,
          title,
          sub: `${tr.note ? tr.note + ' · ' : ''}${formatDay(tr.date)}`,
          amount: adjustment?.amount ?? formatMoney(tr.amount),
          haystack: fold(`${title} ${tr.note}`),
        };
      })
      .filter((r) => words.every((w) => r.haystack.includes(w)));
  });

  protected readonly visible = computed(() => {
    const words = fold(this.search()).split(/\s+/).filter(Boolean);
    const kind = this.kindFilter();
    const category = this.categoryFilter();
    const account = this.accountFilter();
    return (this.rows() ?? []).filter(
      (r) =>
        (kind === 'todos' || (kind === 'ingreso') === r.isIncome) &&
        (!category || r.categoryIds.includes(category)) &&
        (!account ||
          (r.transaction.accountId ?? CASH_ACCOUNT_ID) === account) &&
        words.every((w) => r.haystack.includes(w)),
    );
  });

  protected readonly visibleTotal = computed(() =>
    this.visible().reduce(
      (sum, r) =>
        sum + (r.isIncome ? r.transaction.amount : -r.transaction.amount),
      0,
    ),
  );

  protected readonly money = formatMoney;

  constructor() {
    addIcons({
      attachOutline,
      checkmark,
      chevronDown,
      copyOutline,
      createOutline,
      ellipsisHorizontal,
      searchOutline,
      swapHorizontal,
      trashOutline,
    });
    effect(() => {
      const id = this.categoria();
      if (id) this.categoryFilter.set(id);
    });
    effect(() => {
      const month = this.monthState.month();
      this.monthState.version();
      this.load(month);
    });
  }

  protected tapRow(row: Row) {
    if (this.selecting()) this.toggleSelected(row.id);
    else this.edit(row);
  }

  protected edit(row: Row) {
    this.menuFor.set(null);
    this.form.open(row.transaction);
  }

  protected toggleMenu(row: Row, event: MouseEvent) {
    if (this.menuFor() === row.id) {
      this.menuFor.set(null);
      return;
    }
    // Cerca del final de la pantalla el menú se abre hacia arriba para no quedar bajo la barra inferior.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuUp.set(
      rect.bottom + MENU_HEIGHT > window.innerHeight - BOTTOM_BAR_SPACE,
    );
    this.menuFor.set(row.id);
  }

  protected setMenu(row: Row, open: boolean) {
    if (!open && this.menuFor() === row.id) this.menuFor.set(null);
  }

  protected duplicate(row: Row) {
    this.menuFor.set(null);
    this.form.open(undefined, row.transaction);
  }

  protected async remove(row: Row) {
    this.menuFor.set(null);
    if (
      !(await this.confirm(
        t('movs.deleteTitle'),
        t('movs.deleteMsg', { name: row.title, amount: row.amount }),
      ))
    )
      return;
    try {
      const deleted = await this.container.deleteTransaction.execute(row.id);
      this.monthState.notifyChange();
      this.undo.offer(t('movs.deleted', { name: row.title }), () =>
        this.container.restoreTransaction.execute(deleted),
      );
    } catch (error) {
      console.error(error);
      this.liveMessage.set(t('movs.deleteFailed'));
    }
  }

  /** Copia movimientos de otro mes al que se ve; con "Deshacer" se borran las copias. */
  protected async copyFromMonth() {
    this.headMenuOpen.set(false);
    const modal = await this.modals.create({ component: CopiarModalComponent, componentProps: { to: this.monthState.month() } });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<Transaction[]>();
    if (role !== 'saved' || !data?.length) return;
    this.monthState.notifyChange();
    this.undo.offer(tn('copy.done', data.length), async () => {
      for (const copy of data) await this.container.deleteTransaction.execute(copy.id);
    });
  }

  protected setCategoryFilter(id: string | null) {
    this.categoryFilter.set(id);
    this.categoryMenuOpen.set(false);
  }

  protected setAccountFilter(id: string | null) {
    this.accountFilter.set(id);
    this.accountMenuOpen.set(false);
  }

  protected editTransfer(transfer: Transfer) {
    return this.dineroForm.editTransfer(transfer);
  }

  protected clearFilters() {
    this.search.set('');
    this.kindFilter.set('todos');
    this.categoryFilter.set(null);
    this.accountFilter.set(null);
  }

  // ---------- selección y edición masiva ----------

  protected startSelecting() {
    this.menuFor.set(null);
    this.selected.set(new Set());
    this.selecting.set(true);
  }

  protected stopSelecting() {
    this.selecting.set(false);
    this.selected.set(new Set());
  }

  protected toggleSelected(id: string) {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected selectAllVisible() {
    this.selected.set(new Set(this.visible().map((r) => r.id)));
  }

  protected async bulkCategory() {
    const rows = (this.rows() ?? []).filter((r) => this.selected().has(r.id));
    // Solo se ofrecen categorías del mismo tipo que lo seleccionado; con gastos e ingresos mezclados no hay ninguna.
    const kinds = new Set(rows.map((r) => r.isIncome));
    if (kinds.size !== 1) {
      return this.info(t('movs.mixed'));
    }
    const income = rows[0].isIncome;
    const options = this.categories().filter((c) =>
      income ? c.type === 'ingreso' : isExpenseType(c.type),
    );
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('movs.changeCategory'),
      inputs: options.map((c) => ({
        type: 'radio' as const,
        label: c.name,
        value: c.id,
      })),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('movs.change'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm' || !data?.values) return;
    await this.applyBulk({ categoryId: data.values as string });
  }

  protected async bulkDate() {
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('movs.changeDate'),
      inputs: [
        {
          name: 'date',
          type: 'date',
          value: (this.rows() ?? []).find((r) => this.selected().has(r.id))
            ?.transaction.date,
        },
      ],
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('movs.change'), role: 'confirm' },
      ],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    if (role !== 'confirm' || !data?.values?.date) return;
    await this.applyBulk({ date: data.values.date as string });
  }

  protected async bulkDelete() {
    const ids = [...this.selected()];
    if (
      !(await this.confirm(
        t('movs.bulkDeleteTitle'),
        t('movs.bulkDeleteMsg', { count: ids.length }),
      ))
    )
      return;
    const deleted: DeletedTransaction[] = [];
    try {
      for (const id of ids)
        deleted.push(await this.container.deleteTransaction.execute(id));
    } catch (error) {
      console.error(error);
      this.liveMessage.set(t('movs.bulkDeleteFailed'));
    }
    this.stopSelecting();
    this.monthState.notifyChange();
    this.undo.offer(t('movs.bulkDeleted', { count: deleted.length }), async () => {
      for (const d of deleted)
        await this.container.restoreTransaction.execute(d);
    });
  }

  private async applyBulk(change: { categoryId?: string; date?: string }) {
    try {
      const { updated, skipped } =
        await this.container.bulkUpdateTransactions.execute(
          [...this.selected()],
          change,
        );
      this.stopSelecting();
      this.monthState.notifyChange();
      const extra = skipped ? t('movs.skipped', { count: skipped }) : '';
      await this.info(t('movs.changed', { count: updated }) + extra);
    } catch (error) {
      console.error(error);
      await this.info(t('movs.changeFailed'));
    }
  }

  private async confirm(header: string, message: string): Promise<boolean> {
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header,
      message,
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.delete'), role: 'destructive' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'destructive';
  }

  private async info(message: string) {
    const toast = await this.toasts.create({
      message,
      duration: 3500,
      position: 'top',
      cssClass: 'app-toast',
    });
    await toast.present();
  }

  private async load(month: string) {
    const seq = ++this.loadSeq;
    try {
      const [transactions, categories, accounts, transfers] = await Promise.all(
        [
          this.container.transactions.listByMonth(month),
          this.container.categories.list(),
          this.container.accounts.list(),
          this.container.accounts.listTransfers(month),
        ],
      );
      if (seq !== this.loadSeq) return;
      this.accounts.set(accounts);
      this.transfers.set(transfers);
      const byId = new Map(categories.map((c) => [c.id, c]));
      this.categories.set(categories);
      this.rows.set(
        [...transactions]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((tx) => toRow(tx, byId)),
      );
      this.failed.set(false);
    } catch (error) {
      console.error(error);
      if (seq === this.loadSeq) this.failed.set(true);
    }
  }
}

function toRow(tx: Transaction, byId: Map<string, Category>): Row {
  const category = byId.get(tx.categoryId);
  const isIncome = category?.type === 'ingreso';
  const categoryName = category?.name ?? t('common.noCategory');
  const categoryIds = tx.splits?.length
    ? tx.splits.map((s) => s.categoryId)
    : [tx.categoryId];
  const names = categoryIds.map((id) => byId.get(id)?.name ?? '');
  const tags = tx.tags ?? [];
  const split = (tx.splits?.length ?? 0) > 1;
  return {
    id: tx.id,
    transaction: tx,
    ...lookOf(category ?? { type: isIncome ? 'ingreso' : 'variable' }),
    title: tx.note || categoryName,
    subtitle: `${split ? t('movs.splitName', { name: categoryName, count: tx.splits!.length - 1 }) : categoryName} · ${formatDay(tx.date)}`,
    amount: `${isIncome ? '+' : '−'}${formatMoney(tx.amount)}`,
    isIncome,
    tags,
    hasPhotos: (tx.attachmentCount ?? 0) > 0,
    categoryIds,
    haystack: fold([tx.note, ...names, ...tags].join(' ')),
  };
}
