import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mayoixv.finanzas',
  appName: 'Kuarto',
  webDir: 'www',
  plugins: {
    CapacitorSQLite: {
      // La base no usa contraseña. Con esto en true (su valor por defecto) el plugin abre al arrancar unas
      // preferencias cifradas con una llave del teléfono; si Android las restaura de una copia de seguridad la
      // llave ya no coincide y el plugin no carga ("CapacitorSQLitePlugin: null").
      // Además la copia automática de Android está desactivada (allowBackup="false" en el manifest): no sube la
      // base a Google Drive sin cifrar. Los únicos respaldos son los de Kuarto, cifrados con la contraseña.
      androidIsEncryption: false,
    },
    FirebaseAuthentication: {
      // El inicio de sesión lo hace el SDK nativo de Android (con google-services.json); Firestore usa esa sesión.
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    LocalNotifications: {
      // Ícono de una sola tinta para la barra de estado (android/app/src/main/res/drawable/ic_stat_finanzas.xml).
      smallIcon: 'ic_stat_finanzas',
      iconColor: '#6a3df0',
    },
  },
};

export default config;
