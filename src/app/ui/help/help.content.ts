import { t, tList } from '../i18n';

/**
 * Textos de ayuda de cada pantalla (help en es.json). El recorrido (tour.service.ts) usa estos mismos textos.
 * Reglas: máximo 3 viñetas, 2 líneas cada una, verbo al inicio.
 */
export type HelpTopic =
  | 'inicio'
  | 'movimientos'
  | 'fijos'
  | 'calendario'
  | 'cuentas'
  | 'tarjetas'
  | 'metas'
  | 'deudas'
  | 'calculadoras'
  | 'reportes'
  | 'reglas';

export interface HelpEntry {
  title: string;
  points: string[];
}

/** Título y viñetas de la ayuda de una pantalla, en el idioma actual (help.<tema> en es.json). */
export function helpEntry(topic: HelpTopic): HelpEntry {
  return { title: t(`help.${topic}.title`), points: tList(`help.${topic}.points`) };
}

/** Orden en que se listan en Ajustes › Ayuda. */
export const HELP_TOPICS: HelpTopic[] = [
  'inicio',
  'movimientos',
  'fijos',
  'calendario',
  'cuentas',
  'tarjetas',
  'metas',
  'deudas',
  'calculadoras',
  'reportes',
  'reglas',
];
