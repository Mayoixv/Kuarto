import { Currency } from '../../domain/currency';
import { monthOf } from '../../domain/month';
import { isBigExpense, isPersonality, Personality } from '../../domain/personality';
import { ICategoryRepository, ISettingsRepository } from '../ports/repositories';
import { GetMonthOverview } from './get-month-overview';

const KEY = 'personality';
const ANNOUNCED_KEY = 'personality_announced';
const LAST_JOKE_KEY = 'personality_last_joke';

/** Ajuste "Personalidad" (Ajustes › Notificaciones). Desactivada por defecto. */
export class PersonalitySettings {
  constructor(private readonly settings: ISettingsRepository) {}

  async get(): Promise<Personality> {
    const saved = await this.settings.get(KEY);
    return isPersonality(saved) ? saved : 'off';
  }

  async set(value: Personality): Promise<void> {
    if (isPersonality(value)) await this.settings.set(KEY, value);
  }

  /** true solo la primera vez: el aviso de la opción nueva sale una sola vez. */
  async announceOnce(): Promise<boolean> {
    if (await this.settings.get(ANNOUNCED_KEY)) return false;
    await this.settings.set(ANNOUNCED_KEY, '1');
    return true;
  }

  /** Último chiste mostrado ("comida:2"), para no repetirlo seguido. */
  lastJoke(): Promise<string | undefined> {
    return this.settings.get(LAST_JOKE_KEY);
  }

  setLastJoke(value: string): Promise<void> {
    return this.settings.set(LAST_JOKE_KEY, value);
  }
}

/** Si un movimiento recién guardado es un gasto grande para su mes (ingresos del mismo mes como referencia). */
export class CheckBigExpense {
  constructor(
    private readonly categories: ICategoryRepository,
    private readonly overview: GetMonthOverview,
  ) {}

  async execute(tx: { date: string; amount: number; categoryId: string }, currency: Currency): Promise<boolean> {
    const category = await this.categories.get(tx.categoryId);
    if (!category || category.type === 'ingreso') return false;
    const { summary } = await this.overview.execute(monthOf(tx.date), 0);
    return isBigExpense(tx.amount, summary.income, currency);
  }
}
