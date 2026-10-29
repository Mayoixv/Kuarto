import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TourService } from '../tour/tour.service';
import { HelpService } from '../help/help-button.component';
import { helpEntry, HELP_TOPICS, HelpTopic } from '../help/help.content';
import { AlertController, IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  calendarOutline,
  checkmark,
  chevronBack,
  chevronDown,
  chevronForward,
  close,
  colorPaletteOutline,
  helpCircleOutline,
  informationCircleOutline,
  personOutline,
  search,
  serverOutline,
  shieldCheckmarkOutline,
  walletOutline,
} from 'ionicons/icons';
import { APP_CONTAINER } from '../../app.container';
import { Currency } from '../../domain/currency';
import { CurrencyState } from '../currency-state';
import { ExchangeRateService } from '../exchange-rate.service';
import { DropdownComponent } from '../dropdown.component';
import { MonthState } from '../month-state';
import { DatosComponent } from './datos.component';
import { AvisosComponent } from './avisos.component';
import { APP_VERSION } from '../../version';
import { UpdateService } from '../update/update.service';
import { NewsService } from '../news/news.service';
import { PillOption, PillToggleComponent } from '../pill-toggle.component';
import { Appearance, appearance as savedAppearance, currentPalette, paletteVars, setAppearance, setPalette } from '../theme';
import { generatePalette, hexToRgb, PRESETS } from '../palette';
import { CloudBackupService } from '../cloud/cloud-backup.service';
import { askName } from '../profile-name';
import { Lang, language, LANGUAGES, setLanguage, syncDefaultNames, t, tList } from '../i18n';

/** Título, descripción y opciones (para la búsqueda) de cada sección están en es.json, en ajustes.sections.<id>. */
interface Section {
  id: string;
  icon: string;
}

const SECTIONS: Section[] = [
  { id: 'apariencia', icon: 'color-palette-outline' },
  { id: 'dinero', icon: 'wallet-outline' },
  { id: 'avisos', icon: 'calendar-outline' },
  { id: 'datos', icon: 'server-outline' },
  { id: 'cuenta', icon: 'person-outline' },
  { id: 'seguridad', icon: 'shield-checkmark-outline' },
  { id: 'ayuda', icon: 'help-circle-outline' },
  { id: 'acerca', icon: 'information-circle-outline' },
];

/** Las opciones de una sección, para la búsqueda. Ayuda suma el título de cada guía. */
function sectionOptions(id: string): string[] {
  const options = tList(`ajustes.sections.${id}.options`);
  return id === 'ayuda' ? [...options, ...HELP_TOPICS.map((topic) => helpEntry(topic).title)] : options;
}

/** Color hex a partir de tono, saturación y luminosidad (para las muestras del color propio). */
function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Sin tildes ni mayúsculas, para que "codigo" encuentre "Código". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

@Component({
  selector: 'app-ajustes',
  templateUrl: 'ajustes.page.html',
  styleUrls: ['ajustes.page.scss'],
  imports: [RouterLink, IonContent, IonIcon, PillToggleComponent, DropdownComponent, DatosComponent, AvisosComponent],
})
export class AjustesPage {
  protected readonly t = t;
  protected readonly tList = tList;
  /** Sección abierta (`/ajustes/:seccion`); sin ella, la lista de secciones. */
  readonly seccion = input<string>();
  /** `?activar=1` (fin del recorrido): en Datos y respaldo, empieza a activar el respaldo automático. */
  readonly activar = input<string>();
  /** `?nube=1` (fin del recorrido): en Datos y respaldo, empieza a entrar con Google para el respaldo en la nube. */
  readonly nube = input<string>();
  protected readonly sections = SECTIONS;
  protected readonly section = computed(() => SECTIONS.find((s) => s.id === this.seccion()));
  protected readonly searching = signal(false);
  protected readonly query = signal('');
  protected readonly results = computed(() => {
    const q = fold(this.query().trim());
    return SECTIONS.flatMap((section) =>
      [this.sectionText(section.id, 'title'), ...sectionOptions(section.id)]
        .filter((label) => fold(label).includes(q))
        .map((label) => ({ label, section })),
    );
  });
  protected readonly cloud = inject(CloudBackupService);
  private readonly container = inject(APP_CONTAINER);
  private readonly monthState = inject(MonthState);
  protected readonly currencyState = inject(CurrencyState);
  protected readonly fx = inject(ExchangeRateService);
  private readonly alerts = inject(AlertController);
  protected readonly tour = inject(TourService);
  protected readonly update = inject(UpdateService);
  protected readonly news = inject(NewsService);
  protected readonly appearance = signal<Appearance>(savedAppearance());
  protected readonly appearanceOptions = computed<PillOption[]>(() => [
    { value: 'sistema', label: t('ajustes.themeSystem') },
    { value: 'claro', label: t('ajustes.themeLight') },
    { value: 'oscuro', label: t('ajustes.themeDark') },
  ]);

  protected sectionText(id: string, field: 'title' | 'sub') {
    return t(`ajustes.sections.${id}.${field}`, { version: APP_VERSION });
  }

  protected readonly languages = LANGUAGES;
  protected readonly language = language;

  /** Cambia los textos al instante; las pantallas recargan sus datos para rehacer los textos que arman al cargar. */
  protected async changeLanguage(code: Lang) {
    if (code === language()) return;
    await setLanguage(this.container.settings, code);
    await syncDefaultNames(this.container.settings, this.container.localizeDefaults).catch(console.error);
    this.monthState.notifyChange();
    this.liveMessage.set(t('ajustes.languageChanged'));
  }

  // ---------- paleta de colores
  protected readonly presets = PRESETS;
  /** Tonos de muestra para el color propio, cada 30°. */
  protected readonly hues = Array.from({ length: 12 }, (_, i) => hslHex(i * 30, 75, 45));
  protected readonly savedPalette = signal(currentPalette());
  /** La que se está mirando en la vista previa (se aplica con el botón). */
  protected readonly choice = signal(currentPalette());
  protected readonly isCustom = computed(() => !!hexToRgb(this.choice()));
  protected readonly customHex = signal(hexToRgb(currentPalette()) ? currentPalette() : this.hues[7]);
  protected readonly hexText = signal(this.customHex());
  protected readonly hexError = signal(false);
  protected readonly previewStyle = computed(() => {
    this.appearance();
    return paletteVars(this.choice(), undefined, true);
  });
  /** Avisos del color propio: si se oscureció para que se lea y si se parece a un color de estado. */
  protected readonly paletteNotes = computed(() => {
    if (!this.isCustom()) return { adjusted: false, clashes: [] as string[] };
    const p = generatePalette(this.choice());
    return { adjusted: p.adjusted, clashes: p.clashes.map((c) => t('palette.clash', { what: t('palette.clashWhat.' + c) })) };
  });

  protected choose(value: string) {
    this.choice.set(value);
    this.hexError.set(false);
    if (hexToRgb(value)) {
      this.customHex.set(value);
      this.hexText.set(value.toUpperCase());
    }
  }

  protected typeHex(text: string) {
    const value = (text.startsWith('#') ? text : '#' + text).toLowerCase();
    this.hexText.set(text);
    const ok = !!hexToRgb(value);
    this.hexError.set(!ok && text.replace('#', '').length >= 6);
    if (ok) this.choose(value);
  }

  protected async applyPalette() {
    await setPalette(this.container.settings, this.choice());
    this.savedPalette.set(this.choice());
    this.liveMessage.set(t('palette.applied'));
  }

  /** Se aplica al instante en toda la app y se guarda para la próxima vez. */
  protected changeAppearance(value: string) {
    this.appearance.set(value as Appearance);
    setAppearance(this.container.settings, value as Appearance).catch(console.error);
  }
  protected readonly help = inject(HelpService);
  protected readonly helpTopics = HELP_TOPICS;
  protected helpTitle(topic: HelpTopic) {
    return helpEntry(topic).title;
  }
  protected readonly userName = signal('');
  protected readonly showPrivacy = signal(false);
  protected readonly version = APP_VERSION;

  protected readonly currencies = computed<{ code: Currency; label: string }[]>(() => [
    { code: 'DOP', label: t('ajustes.currencyDOP') },
    { code: 'USD', label: t('ajustes.currencyUSD') },
  ]);

  protected readonly failed = signal(false);
  protected readonly liveMessage = signal('');
  protected readonly currencyOpen = signal(false);
  protected readonly currencyLabel = computed(
    () => this.currencies().find((c) => c.code === this.currencyState.currency())?.label ?? '',
  );

  constructor() {
    addIcons({
      calendarOutline,
      checkmark,
      chevronBack,
      chevronDown,
      chevronForward,
      close,
      colorPaletteOutline,
      helpCircleOutline,
      informationCircleOutline,
      personOutline,
      search,
      serverOutline,
      shieldCheckmarkOutline,
      walletOutline,
    });
    effect(() => {
      this.monthState.version();
      this.load();
    });
  }

  protected toggleSearch() {
    this.searching.set(!this.searching());
    this.query.set('');
    if (this.searching()) setTimeout(() => document.querySelector<HTMLInputElement>('app-ajustes .search input')?.focus());
  }

  protected async editName() {
    try {
      if (!(await askName(this.alerts, this.container))) return;
      await this.load();
      this.monthState.notifyChange();
      this.liveMessage.set(t('ajustes.nameSaved'));
    } catch (error) {
      console.error(error);
      this.liveMessage.set(t('ajustes.nameFailed'));
    }
  }

  protected async setCurrency(code: Currency) {
    this.currencyOpen.set(false);
    if (code === this.currencyState.currency()) return;
    try {
      await this.currencyState.change(code);
      this.liveMessage.set(t('ajustes.currencyChanged', { code }));
    } catch (error) {
      console.error(error);
      this.liveMessage.set(t('ajustes.currencyFailed'));
    }
  }

  private async load() {
    try {
      const [first, last] = await Promise.all([this.container.profile.name(), this.container.profile.lastName()]);
      this.userName.set(`${first} ${last}`.trim());
      this.failed.set(false);
    } catch (error) {
      console.error(error);
      this.failed.set(true);
    }
  }
}
