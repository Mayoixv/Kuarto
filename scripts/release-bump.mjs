// Sube la versión en todos los sitios que la prueba "versiones alineadas" revisa, y agrega las novedades.
//
//   node scripts/release-bump.mjs 1.0.17 "Primera novedad" "Segunda novedad"
//
// Toca: src/app/version.ts, package.json, package-lock.json, android/app/build.gradle (versionCode + 1),
// src/app/ui/news/changelog.ts y changelog.<versión> en los seis src/assets/i18n/<idioma>.json.
// En los idiomas que no son español deja el texto en español y lo avisa: hay que traducirlo antes de publicar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, ...points] = process.argv.slice(2);

if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || points.length === 0) {
  console.error('Uso: node scripts/release-bump.mjs X.Y.Z "Novedad 1" ["Novedad 2" ...]');
  process.exit(1);
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
/** Conserva los finales de línea del archivo (los JSON de i18n van en CRLF por autocrlf). */
const write = (file, text) => {
  const crlf = read(file).includes('\r\n');
  fs.writeFileSync(path.join(root, file), crlf ? text.replace(/\r?\n/g, '\r\n') : text);
};
/** Reemplaza una sola vez y falla si el patrón no está: mejor parar que dejar un archivo a medias. */
const replaceOnce = (file, pattern, replacement) => {
  const text = read(file);
  if (!pattern.test(text)) throw new Error(`${file}: no se encontró ${pattern}`);
  write(file, text.replace(pattern, replacement));
};

const current = /APP_VERSION = '([^']+)'/.exec(read('src/app/version.ts'))[1];
if (version === current) throw new Error(`La versión ya es ${version}`);
const key = version.replaceAll('.', '_');

// 1. version.ts
replaceOnce('src/app/version.ts', /APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`);

// 2. package.json y package-lock.json (la raíz y el paquete "" del lock)
for (const file of ['package.json', 'package-lock.json']) {
  const data = JSON.parse(read(file));
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
  write(file, JSON.stringify(data, null, 2) + '\n');
}

// 3. build.gradle: versionCode + 1 y versionName
const gradle = read('android/app/build.gradle');
const code = Number(/versionCode (\d+)/.exec(gradle)[1]);
replaceOnce('android/app/build.gradle', /versionCode \d+/, `versionCode ${code + 1}`);
replaceOnce('android/app/build.gradle', /versionName "[^"]+"/, `versionName "${version}"`);

// 4. changelog.ts: la versión nueva al frente de la lista
replaceOnce('src/app/ui/news/changelog.ts', /const VERSIONS = \[/, `const VERSIONS = ['${version}', `);

// 5. i18n: changelog.<versión> en los seis idiomas, la nueva primero para que quede arriba en el archivo
const languages = fs
  .readdirSync(path.join(root, 'src/assets/i18n'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));
const untranslated = [];
for (const lang of languages) {
  const file = `src/assets/i18n/${lang}.json`;
  const data = JSON.parse(read(file));
  if (data.changelog?.[key]) throw new Error(`${file}: changelog.${key} ya existe`);
  data.changelog = { [key]: points, ...data.changelog };
  write(file, JSON.stringify(data, null, 2) + '\n');
  if (lang !== 'es') untranslated.push(file);
}

console.log(`Versión ${current} → ${version} (versionCode ${code} → ${code + 1}).`);
console.log(`Novedades en changelog.${key}: ${points.length} punto(s).`);
console.log(`Traducir changelog.${key} en: ${untranslated.join(', ')}`);
console.log('Luego: npm test (la prueba "versiones alineadas" confirma que todo coincide).');
