import { tList } from '../i18n';

/**
 * Novedades de cada versión, de la más nueva a la más vieja. Se muestran una vez al abrir la app después de
 * actualizar, y en Ajustes › Novedades. Textos cortos, para quien usa la app (no detalles técnicos).
 * Los textos están en es.json, en changelog.<versión con guiones bajos>; el mismo texto sirve para el Release en GitHub.
 */
export interface ChangelogEntry {
  version: string;
  points: string[];
}

const VERSIONS = ['1.0.15', '1.0.14', '1.0.13', '1.0.12', '1.0.11', '1.0.10', '1.0.9', '1.0.8', '1.0.7', '1.0.6', '1.0.5', '1.0.4'];

export const CHANGELOG: ChangelogEntry[] = VERSIONS.map((version) => ({
  version,
  get points() {
    return tList(`changelog.${version.replaceAll('.', '_')}`);
  },
}));
