import { Account } from './account';
import { Category } from './category';
import { Cents } from './money';
import { addDays, IsoDate } from './month';

/** Lo que se entendió de una frase como "gasté 500 en gasolina". Lo que no se entendió queda en null. */
export interface QuickEntry {
  amount: Cents | null;
  kind: 'gasto' | 'ingreso' | null;
  categoryId: string | null;
  /** Cuenta nombrada en la frase ("con la tarjeta popular", "en efectivo"); null si no se nombró ninguna. */
  accountId: string | null;
  /** Solo si la frase dice cuándo ("ayer", "antier", "hace 3 días"); null si no lo dice. */
  date: IsoDate | null;
  /** Etiquetas escritas como #trabajo. */
  tags: string[];
  note: string;
}

/** Cuentas del usuario y la fecha de hoy, para entender la cuenta y las fechas relativas. */
export interface QuickContext {
  accounts?: Pick<Account, 'id' | 'name' | 'archived'>[];
  today?: IsoDate;
}

/** Palabras que apuntan a las categorías de la app (por su id, que no cambia con el idioma). */
const KEYWORDS: Record<string, string[]> = {
  'cat-salario': ['sueldo', 'salario', 'quincena', 'nomina', 'salary', 'paycheck'],
  'cat-comida': ['comida', 'almuerzo', 'cena', 'desayuno', 'restaurante', 'pizza', 'pollo', 'empanada', 'yaroa', 'chimi', 'cafe', 'propina', 'food', 'lunch', 'dinner', 'tip'],
  'cat-supermercado': ['super', 'supermercado', 'colmado', 'compra', 'jumbo', 'sirena', 'nacional', 'bravo', 'groceries'],
  'cat-transporte': ['uber', 'taxi', 'guagua', 'carrito', 'concho', 'motoconcho', 'pasaje', 'metro', 'peaje', 'parqueo'],
  'cat-gasolina': ['gasolina', 'combustible', 'gasoil', 'diesel', 'gas', 'bomba'],
  'cat-luz': ['luz', 'edesur', 'edenorte', 'edeeste', 'electricidad'],
  'cat-agua': ['agua', 'caasd', 'botellon'],
  'cat-internet': ['internet', 'cable', 'wifi'],
  'cat-telefono': ['telefono', 'celular', 'recarga', 'claro', 'altice', 'viva'],
  'cat-salud': ['farmacia', 'medicina', 'doctor', 'medico', 'clinica', 'consulta', 'pastillas'],
  'cat-ocio': ['cine', 'fiesta', 'bar', 'cerveza', 'romo', 'salida', 'concierto', 'playa'],
  'cat-suscripciones': ['netflix', 'spotify', 'disney', 'youtube', 'hbo', 'suscripcion', 'prime'],
  'cat-ropa': ['ropa', 'zapatos', 'tenis', 'camisa', 'pantalon', 'vestido'],
  'cat-hogar': ['hogar', 'casa', 'mueble', 'ferreteria', 'limpieza'],
  'cat-educacion': ['colegio', 'universidad', 'libro', 'libros', 'curso', 'inscripcion', 'matricula'],
  'cat-alquiler': ['alquiler', 'renta', 'rent'],
  'cat-seguros': ['seguro', 'ars', 'poliza'],
  'cat-pago-deudas': ['prestamo', 'deuda', 'cuota', 'tarjeta'],
};

const INCOME =
  /\b(cobre|me pagaron|me pago|recibi|me depositaron|me transfirieron|me entro|me entraron|me devolvieron|deposito|cheque\w*|reembolso|gane|vendi|ingreso|got paid|received|earned|refund)\b/;
/** Palabras de relleno que no van en la nota. */
const FILLER = new Set(
  'gaste pague pago pagando compre di cobre recibi gane vendi me mi mis pagaron depositaron transfirieron entro entraron en de del por para el la los las un una al y con pesos peso dolares dolar rd us spent paid bought gave on for at the a with from to my'.split(
    ' ',
  ),
);
/** Palabras genéricas que acompañan a una cuenta ("con la tarjeta popular"); se quitan si la cuenta se reconoció. */
const ACCOUNT_WORDS = new Set(['tarjeta', 'cuenta', 'banco', 'card', 'account', 'bank']);

/** Fechas relativas: días hacia atrás desde hoy. */
const DATES: [RegExp, (m: RegExpExecArray) => number][] = [
  [/\b(hoy|today)\b/, () => 0],
  [/\b(ayer|yesterday)\b/, () => 1],
  [/\b(antier|anteayer|antes de ayer)\b/, () => 2],
  [/\bhace (\d{1,2}) dias?\b/, (m) => Number(m[1])],
  [/\b(\d{1,2}) days? ago\b/, (m) => Number(m[1])],
];

const plain = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const split = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Misma palabra, o una letra de diferencia en palabras de 5 letras o más (tolera "gasolna" y "sirenna"). */
export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  // Una sustitución si miden igual; una letra de más en la larga si no.
  return short.length === long.length ? short.slice(i + 1) === long.slice(i + 1) : short.slice(i) === long.slice(i + 1);
}

/** "1,500" / "1.500" / "1500.50" / "2k" / "5 mil" / "mil" a centavos. Coma o punto seguidos de 3 cifras son miles. */
function findAmount(text: string): { cents: Cents; match: string } | null {
  const m = /(?:rd\$|us\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)\s*(k\b|mil\b)?/.exec(text);
  if (m) {
    const whole = Number(m[1].replace(/[.,]/g, ''));
    const cents = whole * 100 + Number((m[2] ?? '').padEnd(2, '0'));
    return { cents: m[3] ? cents * 1000 : cents, match: m[0] };
  }
  const mil = /\bmil\b/.exec(text);
  return mil ? { cents: 100_000, match: mil[0] } : null;
}

/** La cuenta cuyo nombre más coincide con la frase; ninguna si hay empate ("tarjeta" con dos tarjetas). */
function findAccount(words: string[], accounts: QuickContext['accounts'] = []): { id: string; words: string[] } | null {
  const scored = accounts
    .filter((a) => !a.archived)
    .map((a) => {
      const tokens = split(plain(a.name)).filter((t) => t.length >= 2);
      const matched = words.filter((w) => tokens.some((t) => similar(w, t)));
      return { id: a.id, words: matched, score: matched.length, ratio: tokens.length ? matched.length / tokens.length : 0 };
    })
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || b.ratio - a.ratio);
  const [best, second] = scored;
  if (!best || (second && second.score === best.score && second.ratio === best.ratio)) return null;
  return { id: best.id, words: best.words };
}

/**
 * Entiende una frase escrita o dictada: monto, si es gasto o ingreso, categoría, cuenta, fecha, etiquetas y nota.
 * La categoría sale, en orden, del nombre de una categoría dicho en la frase, de notas anteriores con la misma
 * palabra, o de las palabras clave de las categorías de la app. Tolera una letra mal escrita.
 * ponytail: las palabras clave y de relleno están en español e inglés; agregar más idiomas si se usan.
 */
export function parseQuickEntry(
  text: string,
  categories: Category[],
  history: { note: string; categoryId: string }[] = [],
  context: QuickContext = {},
): QuickEntry {
  const tags = [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);
  const untagged = text.replace(/#[\p{L}\p{N}_-]+/gu, ' ').trim();
  let lower = plain(untagged);

  let date: IsoDate | null = null;
  const dateWords = new Set<string>();
  for (const [pattern, back] of DATES) {
    const m = pattern.exec(lower);
    if (!m) continue;
    if (context.today) date = addDays(context.today, -back(m));
    for (const w of split(m[0])) dateWords.add(w);
    lower = lower.replace(m[0], ' ');
    break;
  }

  const found = findAmount(lower);
  const rest = found ? lower.replace(found.match, ' ') : lower;
  let words = split(rest);

  const account = findAccount(words, context.accounts);
  const accountWords = new Set(account?.words ?? []);
  if (account) words = words.filter((w) => !accountWords.has(w) && !ACCOUNT_WORDS.has(w));

  const visible = categories.filter((c) => !c.hidden);
  const byName = visible
    .filter((c) => split(plain(c.name)).every((tok) => words.some((w) => similar(w, tok))))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const learned = byName ? undefined : fromHistory(words, history, visible);
  const byKeyword = byName || learned ? undefined : visible.find((c) => KEYWORDS[c.id]?.some((k) => words.some((w) => similar(w, k))));
  const category = byName ?? learned ?? byKeyword;

  const kind = category ? (category.type === 'ingreso' ? 'ingreso' : 'gasto') : INCOME.test(lower) ? 'ingreso' : found ? 'gasto' : null;
  const token = (w: string) => plain(w).replace(/[^\p{L}\p{N}$]/gu, '');
  const drop = new Set([...(found?.match.split(/\s+/).map(token) ?? []), ...dateWords, ...accountWords]);
  const original = untagged
    .split(/\s+/)
    .filter((w) => {
      const tk = token(w);
      return tk && !FILLER.has(tk) && !drop.has(tk) && !(account && ACCOUNT_WORDS.has(tk));
    })
    .join(' ');
  return {
    amount: found?.cents || null,
    kind,
    categoryId: category?.id ?? null,
    accountId: account?.id ?? null,
    date,
    tags,
    note: original.charAt(0).toLocaleUpperCase() + original.slice(1),
  };
}

/** La categoría que más se usó con alguna de estas palabras en la nota (de 4 letras o más, con una letra de tolerancia). */
function fromHistory(words: string[], history: { note: string; categoryId: string }[], categories: Category[]): Category | undefined {
  const wanted = words.filter((w) => w.length >= 4 && !FILLER.has(w));
  if (!wanted.length) return undefined;
  const counts = new Map<string, number>();
  for (const h of history) {
    if (split(plain(h.note)).some((w) => wanted.some((x) => similar(w, x)))) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? categories.find((c) => c.id === best[0]) : undefined;
}
