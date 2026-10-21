import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor/privacy-screen';
import { ISettingsRepository } from '../application/ports/repositories';

const KEY = 'privacy_screen';

export const privacyAvailable = Capacitor.isNativePlatform();

/** Activada salvo que se haya apagado: la migración 16 deja '0' a quien ya usaba la app sin tocarla. */
export async function isPrivacyOn(settings: ISettingsRepository): Promise<boolean> {
  return (await settings.get(KEY)) !== '0';
}

/**
 * Oculta la app en la vista de recientes (la oscurece) e impide capturas de pantalla.
 * Solo en el teléfono; en el navegador no hace nada.
 */
export async function applyPrivacy(on: boolean): Promise<void> {
  if (!privacyAvailable) return;
  if (on) await PrivacyScreen.enable({ android: { dimBackground: true } });
  else await PrivacyScreen.disable();
}

export async function setPrivacy(settings: ISettingsRepository, on: boolean): Promise<void> {
  await applyPrivacy(on);
  await settings.set(KEY, on ? '1' : '0');
}
