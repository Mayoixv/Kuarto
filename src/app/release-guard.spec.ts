import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Durante las pruebas en el navegador se expone el contenedor en window.__c; nunca debe llegar a una versión,
// porque daría acceso a todos los datos (y a quitar el PIN) desde la consola.
describe('versión limpia', () => {
  it('main.ts no expone el contenedor de la app en window', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).not.toContain('__c');
  });
});

// Si se sube una versión y se olvida otro archivo, la app se anuncia con un número y el APK trae otro.
describe('versiones alineadas', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
  const app = /APP_VERSION = '([^']+)'/.exec(read('src/app/version.ts'))![1];

  it('package.json, version.ts, build.gradle y las novedades dicen la misma versión', () => {
    const gradle = read('android/app/build.gradle');
    expect(JSON.parse(read('package.json')).version).toBe(app);
    expect(/versionName "([^"]+)"/.exec(gradle)![1]).toBe(app);
    expect(/const VERSIONS = \['([^']+)'/.exec(read('src/app/ui/news/changelog.ts'))![1]).toBe(app);
  });
});
