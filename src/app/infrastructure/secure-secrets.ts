import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { ISettingsRepository } from '../application/ports/repositories';

/**
 * Secretos en el almacenamiento seguro de Android (cifrado con una llave del Keystore), fuera de la base SQLite.
 * Un valor vacío borra la clave. En el navegador, el plugin usa localStorage: solo sirve para desarrollar.
 */
export class SecureSecrets implements ISettingsRepository {
  async get(key: string): Promise<string | undefined> {
    try {
      return (await SecureStorage.getItem(key)) ?? undefined;
    } catch (error) {
      console.error('No se pudo leer el almacenamiento seguro', error);
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (value) await SecureStorage.setItem(key, value);
    else await SecureStorage.removeItem(key);
  }
}
