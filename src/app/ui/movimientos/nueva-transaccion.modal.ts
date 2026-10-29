import { parseQuickEntry } from '../../domain/quick-entry';
import { Component, computed, inject, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { DateFieldComponent } from '../select/date-field.component';
import { SelectFieldComponent } from '../select/select-field.component';
import { CategoryFieldComponent } from '../select/category-field.component';
import {
  IonContent,
  IonIcon,
  IonInput,
  AlertController,
  ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, cameraOutline, close, mic, micOutline } from 'ionicons/icons';
import { Account, CASH_ACCOUNT_ID } from '../../domain/account';
import { accountChoices, accountOptions, rememberAccount } from '../cuentas/account-choices';
import { PersonalityService } from '../personality.service';
import { lastCategoryKey } from '../../application/use-cases/quick-expense';
import { APP_CONTAINER } from '../../app.container';
import { Category, isExpenseType } from '../../domain/category';
import { monthOf } from '../../domain/month';
import { normalizeTags, Transaction } from '../../domain/transaction';
import { amountToInput, defaultDateFor, formatDay, formatMoney, parseAmount } from '../format';
import { CurrencyState } from '../currency-state';
import { photoToDataUrl, pickImage } from '../image';
import { MonthState } from '../month-state';
import { SuccessCheckComponent } from '../success-check.component';
import { UndoService } from '../undo.service';
import { t, errorText, locale } from '../i18n';

type Kind = 'gasto' | 'ingreso';

/** Cuánto se ve el check de éxito antes de cerrar (design.md, 10.2). */
const SUCCESS_VISIBLE_MS = 1200;
const MAX_PHOTOS = 3;

interface Part {
  categoryId: string | null;
  amount: string;
}

interface Photo {
  id: string;
  data: string;
  isNew: boolean;
}

@Component({
  selector: 'app-nueva-transaccion',
  templateUrl: 'nueva-transaccion.modal.html',
  styleUrls: ['nueva-transaccion.modal.scss'],
  imports: [DateFieldComponent, SelectFieldComponent, CategoryFieldComponent, IonContent, IonIcon, IonInput, SuccessCheckComponent],
})
export class NuevaTransaccionModalComponent implements OnInit, OnDestroy {
  protected readonly t = t;
  private readonly container = inject(APP_CONTAINER);
  private readonly modalCtrl = inject(ModalController);
  private readonly personality = inject(PersonalityService);
  private readonly alerts = inject(AlertController);
  private readonly undo = inject(UndoService);

  /** Si llega, el formulario edita este movimiento en vez de crear uno. */
  @Input() transaction?: Transaction;
  /** Si llega, el formulario crea un movimiento nuevo con estos datos (Duplicar); la fecha queda en hoy. */
  @Input() copyOf?: Transaction;

  private readonly categories = signal<Category[]>([]);
  protected readonly kind = signal<Kind>('gasto');
  protected readonly categoryId = signal<string | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly accountId = signal(CASH_ACCOUNT_ID);
  protected readonly accountOptions = computed(() => accountOptions(this.accounts()));
  protected readonly amount = signal('');
  protected readonly date = signal(defaultDateFor(inject(MonthState).month()));
  protected readonly note = signal('');
  protected readonly tags = signal('');
  protected readonly splitOn = signal(false);
  protected readonly parts = signal<Part[]>([]);
  protected readonly photos = signal<Photo[]>([]);
  protected readonly viewing = signal<string | null>(null);
  private readonly removedPhotos: string[] = [];
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly currency = inject(CurrencyState).currency;
  protected readonly isEdit = signal(false);
  protected readonly isCopy = signal(false);
  protected readonly maxPhotos = MAX_PHOTOS;
  /** Notas anteriores con su categoría, para que la frase rápida aprenda; se leen al usarla por primera vez. */
  private history?: { note: string; categoryId: string }[];
  protected readonly quickText = signal('');
  protected readonly canDictate = signal(false);
  protected readonly listening = signal(false);
  protected readonly micError = signal<string | null>(null);

  protected readonly options = computed(() =>
    this.categories().filter((c) =>
      this.kind() === 'ingreso' ? c.type === 'ingreso' : isExpenseType(c.type),
    ),
  );

  /** Centavos sin asignar a ninguna parte (negativo si las partes se pasan del total). */
  protected readonly remaining = computed(() => {
    const total = parseAmount(this.amount()) ?? 0;
    return total - this.parts().reduce((sum, p) => sum + (parseAmount(p.amount) ?? 0), 0);
  });

  private readonly splitValid = computed(
    () =>
      this.parts().length >= 2 &&
      this.remaining() === 0 &&
      this.parts().every((p) => p.categoryId && parseAmount(p.amount) !== null),
  );

  protected readonly saveLabel = computed(() => {
    if (this.isEdit()) return t('common.saveChanges');
    return this.kind() === 'ingreso' ? t('tx.saveIncome') : t('tx.saveExpense');
  });

  protected readonly doneMessage = computed(() => {
    if (this.isEdit()) return t('common.changesSaved');
    return this.kind() === 'ingreso' ? t('tx.incomeSaved') : t('tx.expenseSaved');
  });

  protected readonly canSave = computed(
    () =>
      parseAmount(this.amount()) !== null &&
      (this.splitOn() ? this.splitValid() : this.categoryId() !== null) &&
      !this.saving(),
  );

  protected readonly money = formatMoney;
  protected readonly abs = Math.abs;

  constructor() {
    addIcons({ addOutline, cameraOutline, close, mic, micOutline });
  }

  async ngOnInit() {
    if (Capacitor.isNativePlatform() && !this.transaction && !this.copyOf) {
      SpeechRecognition.available().then((r) => this.canDictate.set(r.available), () => undefined);
    }
    const categories = await this.container.categories.list();
    this.categories.set(categories);

    const tx = this.transaction ?? this.copyOf;
    const choices = await accountChoices(this.container, tx?.accountId);
    this.accounts.set(choices.accounts);
    this.accountId.set(choices.selected);
    if (!tx) {
      await this.applyLastCategory();
      return;
    }
    const category = categories.find((c) => c.id === tx.categoryId);
    this.isEdit.set(!!this.transaction);
    this.isCopy.set(!this.transaction);
    this.kind.set(category?.type === 'ingreso' ? 'ingreso' : 'gasto');
    this.categoryId.set(tx.categoryId);
    this.amount.set(amountToInput(tx.amount));
    if (this.transaction) this.date.set(tx.date);
    this.note.set(tx.note);
    this.tags.set((tx.tags ?? []).join(', '));
    if (tx.splits?.length) {
      this.splitOn.set(true);
      this.parts.set(tx.splits.map((s) => ({ categoryId: s.categoryId, amount: amountToInput(s.amount) })));
    }
    // Las fotos no se copian al duplicar: un recibo es de un solo gasto.
    if (this.transaction) {
      const attachments = await this.container.transactions.listAttachments(tx.id);
      this.photos.set(attachments.map((a) => ({ id: a.id, data: a.data, isNew: false })));
    }
  }

  ngOnDestroy() {
    if (this.listening()) void SpeechRecognition.stop();
    if (this.canDictate()) void SpeechRecognition.removeAllListeners();
  }

  /** Botón del micrófono: dicta la frase rápida con el reconocimiento de voz del teléfono; tocarlo otra vez lo detiene. */
  protected async dictate() {
    if (this.listening()) return SpeechRecognition.stop();
    this.micError.set(null);
    const { speechRecognition } = await SpeechRecognition.requestPermissions();
    if (speechRecognition !== 'granted') return this.micError.set(t('quick.noMic'));
    await SpeechRecognition.removeAllListeners();
    await SpeechRecognition.addListener('partialResults', ({ matches }) => {
      if (!matches[0]) return;
      this.quickText.set(matches[0]);
      void this.quick(matches[0]);
    });
    await SpeechRecognition.addListener('listeningState', ({ status }) => this.listening.set(status === 'started'));
    this.listening.set(true);
    try {
      await SpeechRecognition.start({ language: locale(), partialResults: true, popup: false });
    } catch {
      this.listening.set(false);
      this.micError.set(t('quick.failed'));
    }
  }

  /** "Gasté 500 en gasolina": llena tipo, monto, categoría y nota mientras se escribe o se dicta. */
  protected async quick(text: string) {
    this.history ??= (await this.container.transactions.listAll())
      .filter((tx) => tx.note)
      .slice(-500)
      .map((tx) => ({ note: tx.note, categoryId: tx.categoryId }));
    const entry = parseQuickEntry(text, this.categories(), this.history);
    if (entry.kind && entry.kind !== this.kind()) {
      this.kind.set(entry.kind);
      this.categoryId.set(null);
    }
    if (entry.amount !== null) this.amount.set(amountToInput(entry.amount));
    if (entry.categoryId) this.categoryId.set(entry.categoryId);
    this.note.set(entry.note);
  }

  protected async setKind(value: Kind) {
    this.kind.set(value);
    this.categoryId.set(null);
    this.splitOn.set(false);
    this.parts.set([]);
    if (!this.isEdit()) await this.applyLastCategory();
  }

  protected toggleSplit() {
    if (this.splitOn()) {
      this.splitOn.set(false);
      this.parts.set([]);
      return;
    }
    this.splitOn.set(true);
    this.parts.set([
      { categoryId: this.categoryId(), amount: this.amount() },
      { categoryId: null, amount: '' },
    ]);
  }

  protected addCategory(c: Category) {
    this.categories.update((list) => [...list, c]);
  }

  protected updatePart(index: number, change: Partial<Part>) {
    this.parts.update((list) => list.map((p, i) => (i === index ? { ...p, ...change } : p)));
  }

  protected addPart() {
    this.parts.update((list) => [...list, { categoryId: null, amount: '' }]);
  }

  protected removePart(index: number) {
    this.parts.update((list) => list.filter((_, i) => i !== index));
  }

  protected async addPhoto() {
    const file = await pickImage();
    if (!file) return;
    try {
      const data = await photoToDataUrl(file);
      this.photos.update((list) => [...list, { id: crypto.randomUUID(), data, isNew: true }]);
    } catch (e) {
      console.error(e);
      this.error.set(t('tx.photoFailed'));
    }
  }

  protected removePhoto(photo: Photo) {
    if (!photo.isNew) this.removedPhotos.push(photo.id);
    this.photos.update((list) => list.filter((p) => p.id !== photo.id));
  }

  protected cancel() {
    return this.modalCtrl.dismiss(null, 'cancel');
  }

  protected async save() {
    const categoryId = this.splitOn() ? this.parts()[0]?.categoryId : this.categoryId();
    if (!categoryId) return;
    const input = {
      date: this.date(),
      amount: parseAmount(this.amount()) ?? 0,
      categoryId,
      note: this.note(),
      tags: normalizeTags(this.tags()),
      accountId: this.accountId(),
      splits: this.splitOn()
        ? this.parts().map((p) => ({ categoryId: p.categoryId!, amount: parseAmount(p.amount) ?? 0 }))
        : [],
    };
    if (!this.transaction && !(await this.confirmIfDuplicate(input.date, input.amount, categoryId))) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = this.transaction
        ? await this.container.updateTransaction.execute(this.transaction.id, input)
        : await this.container.addTransaction.execute(input);
      for (const id of this.removedPhotos) await this.container.transactions.deleteAttachment(id);
      for (const p of this.photos().filter((x) => x.isNew)) {
        await this.container.transactions.saveAttachment({ id: p.id, transactionId: saved.id, data: p.data });
      }
      if (!this.splitOn()) await this.container.settings.set(lastCategoryKey(this.kind()), categoryId);
      await rememberAccount(this.container, this.accountId());
      this.saved.set(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_VISIBLE_MS));
      await this.modalCtrl.dismiss(null, 'saved');
      // Con la personalidad "Chistosa", un gasto nuevo y grande trae un chiste; no se espera por él.
      if (!this.transaction) this.personality.afterSave(saved).catch(console.error);
    } catch (e) {
      this.error.set(errorText(e, 'common.saveFailed'));
      this.saving.set(false);
    }
  }

  protected async confirmDelete() {
    const tx = this.transaction;
    if (!tx) return;
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('tx.delete'),
      message: t('tx.deleteMsg'),
      buttons: [
        { text: t('common.cancel'), role: 'cancel' },
        { text: t('common.delete'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const deleted = await this.container.deleteTransaction.execute(tx.id);
      await this.modalCtrl.dismiss(null, 'deleted');
      this.undo.offer(t('tx.deleted'), () => this.container.restoreTransaction.execute(deleted));
    } catch (e) {
      console.error(e);
      this.error.set(t('common.deleteFailed'));
      this.saving.set(false);
    }
  }

  /** Propone la categoría usada la última vez para este tipo, si todavía existe. */
  private async applyLastCategory() {
    const last = await this.container.settings.get(lastCategoryKey(this.kind()));
    if (last && this.options().some((c) => c.id === last && !c.hidden)) this.categoryId.set(last);
  }

  /** Avisa (no bloquea) si ya hay un movimiento con la misma fecha, monto y categoría. */
  private async confirmIfDuplicate(date: string, amount: number, categoryId: string): Promise<boolean> {
    const same = (await this.container.transactions.listByMonth(monthOf(date))).find(
      (tx) => tx.date === date && tx.amount === amount && tx.categoryId === categoryId,
    );
    if (!same) return true;
    const name = this.categories().find((c) => c.id === categoryId)?.name ?? '';
    const alert = await this.alerts.create({
      cssClass: 'app-alert',
      header: t('tx.dupTitle'),
      message: t('tx.dupMsg', {
        amount: formatMoney(amount),
        name,
        date: formatDay(date),
        note: same.note ? t('tx.dupNote', { note: same.note }) : '',
      }),
      buttons: [
        { text: t('tx.dontSave'), role: 'cancel' },
        { text: t('tx.saveAnyway'), role: 'confirm' },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'confirm';
  }
}
