# Kuarto

App de finanzas personales para Android. Anotas lo que entra y lo que sale cada mes, tus pagos fijos, tus cuentas y tarjetas, tus metas y tus deudas, y ves cómo vas.

Todo se guarda en tu teléfono, sin publicidad. Si quieres, el respaldo semanal se sube cifrado a tu cuenta de Google.

## Qué hace

- **Inicio:** balance del mes (ingresos − gastos − ahorrado), porcentaje de ahorro, alertas y patrimonio.
- **Movimientos:** ingresos y gastos con categoría, cuenta, nota y fecha. Búsqueda y filtros.
- **Fijos:** sueldo, alquiler, servicios y suscripciones que se repiten cada mes, con su estado (pagado, pendiente, vencido) y las cuotas de las deudas.
- **Dinero:** cuentas de banco, efectivo y tarjetas de crédito, con su saldo. Transferencias y pago de tarjeta sin contarlos como gasto. Corte, fecha de pago y uso del límite de cada tarjeta.
- **Planes:** metas de ahorro con aportes desde una cuenta, y deudas (lo que debes o te deben) con calendario de cuotas.
- **Reportes:** meses comparados, gasto por categoría y exportación del mes a PDF.
- **Presupuestos** por categoría, **avisos** de pagos próximos, **PIN y huella**, y **respaldos cifrados** (manuales o automáticos cada día o cada semana).
- **Copiar de otro mes:** pasa los gastos del mes pasado al actual, con montos editables y deshacer.
- **Importar desde Excel o CSV**, con plantilla descargable, revisión de errores y deshacer.
- **Bienvenida** con preguntas iniciales que dejan listas cuentas, sueldo, fijos, deudas y metas, y un **recorrido** con ejemplos.
- **Apariencia:** modo claro u oscuro, paletas de color o un color propio.
- **Idiomas:** español, inglés, portugués, francés, italiano y japonés (las traducciones son borradores sin revisión nativa).
- Moneda en pesos dominicanos (RD$) o dólares (US$). Solo cambia el símbolo, no convierte montos.

## Instalar

1. Descarga el último `Kuarto-X.Y.Z.apk` desde [Releases](https://github.com/Mayoixv/App-Finanzas/releases/latest).
2. Ábrelo en el teléfono y permite instalar apps de esa fuente cuando Android lo pida.
3. Si Play Protect avisa, toca **Más detalles › Instalar de todas formas**. La app no está en la Play Store, por eso avisa.

Requiere Android 7.0 o más nuevo.

### Actualizaciones

La app revisa una vez al día si hay una versión nueva en Releases (también en **Ajustes › Buscar actualización**). Si la hay, la descarga y Android muestra **Instalar**. Tus datos se quedan como están.

Para revisar solo lee la lista de versiones de GitHub: no envía ningún dato tuyo.

## Tus datos

- Viven en una base SQLite dentro del teléfono.
- **Ajustes › Tus datos › Crear respaldo** guarda un archivo cifrado con tu contraseña en `Documentos/Kuarto`. Cópialo fuera del teléfono (Drive, correo).
- **Respaldo en la nube** (opcional): entras con Google y el respaldo semanal se sube cifrado con tu contraseña a Firebase. Nadie puede leerlo sin esa contraseña.
- Para pasar tus datos a otro teléfono: instala Kuarto y usa **Restaurar respaldo** con el archivo, o **Restaurar desde la nube**.
- Android no copia la app por su cuenta a tu cuenta de Google: los únicos respaldos son los de Kuarto.
- Al restaurar un respaldo, el respaldo automático queda apagado hasta que vuelvas a poner su contraseña (la contraseña no viaja dentro del respaldo).
- Si borras la app sin un respaldo, tus datos se pierden: nadie más tiene una copia.

## Desarrollo

Hecha con Ionic + Angular (componentes standalone) y Capacitor, con los datos en SQLite (`@capacitor-community/sqlite`).

```
src/app/
  domain/          entidades y reglas puras (montos en centavos enteros)
  application/     casos de uso e interfaces de repositorio
  infrastructure/  repositorios SQLite y migraciones
  ui/              pantallas y componentes
```

Las dependencias apuntan hacia adentro: `ui → application → domain`. Cada cambio de esquema es una migración nueva en `infrastructure/sqlite/migrations.ts`.

Los textos de la interfaz están en `src/assets/i18n/<idioma>.json` (el español es la base) y se leen con `t()` de `ui/i18n.ts`. Una prueba falla si a un idioma le falta una clave o un `{dato}` del español.

Para leer y crear archivos de Excel se usa SheetJS, instalado desde su fuente oficial: el paquete está en `vendor/xlsx-0.20.3.tgz` (el de npm está desactualizado).

El respaldo en la nube usa Firebase (Authentication con Google y Firestore). Para compilarlo necesitas el `google-services.json` de tu proyecto en `android/app/` (no está en el repositorio). Las reglas de Firestore están en `firestore.rules` (cada cuenta solo lee y escribe sus respaldos); se publican con `firebase deploy --only firestore:rules`.

`npm audit` marca avisos altos en `@grpc/grpc-js`, que llega por `firebase`. No aplican al APK: `@grpc/grpc-js` solo corre en Node y no entra en `www/`. El SDK web de Firebase sí entra, pero solo lo cargan los plugins `@capacitor-firebase/*` en el navegador; en Android usan el SDK nativo. No se puede quitar `firebase` porque esos plugins lo importan al compilar. El CI solo frena con un aviso crítico.

La contraseña del respaldo automático se guarda en el almacenamiento seguro de Android (`@aparajita/capacitor-secure-storage`, con el Keystore), no en la base: ni los respaldos ni las copias previas la llevan.

Necesitas Node 22.5 o más nuevo (las pruebas usan `node:sqlite`) y, para Android, JDK 21 y el SDK de Android.

```bash
npm install
npm start            # la app en el navegador, en http://localhost:4200
npm test             # pruebas
npm run lint
```

APK de prueba:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

### Publicar una versión

1. Sube el número en `src/app/version.ts`, en `package.json` (`npm version X.Y.Z --no-git-tag-version`, que también cambia `package-lock.json`) y `versionCode` / `versionName` en `android/app/build.gradle`. Agrega la versión a `src/app/ui/news/changelog.ts` con sus novedades. `npm test` falla si alguno no coincide.
   Sube también `package.json` y `package-lock.json` con el resto de los cambios.
2. Compila con `./gradlew assembleRelease`. La firma se lee de `../../firma/keystore.properties`, fuera del repositorio; sin ese archivo el APK sale sin firmar.
3. Crea un Release en GitHub con la etiqueta `vX.Y.Z` y adjunta el APK como `Kuarto-X.Y.Z.apk`.

Todas las versiones deben firmarse con la misma llave: Android no instala una actualización firmada con otra.
