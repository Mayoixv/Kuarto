import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/** Carpeta visible en "Mis archivos" del teléfono donde se guardan respaldos y exportaciones. */
export const FILES_FOLDER = 'Kuarto';

/**
 * Guarda un archivo en Documentos/Kuarto del teléfono y devuelve dónde quedó, para decírselo al usuario.
 * En el navegador lo descarga y devuelve ''.
 */
export async function saveFile(name: string, content: string, mime: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: `${FILES_FOLDER}/${name}`,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return `Documentos/${FILES_FOLDER}/${name}`;
  }
  download(new Blob([content], { type: mime }), name);
  return '';
}

/** Como saveFile, para archivos binarios (un PDF) que llegan en base64. */
export async function saveBinaryFile(name: string, base64: string, mime: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({ path: `${FILES_FOLDER}/${name}`, data: base64, directory: Directory.Documents, recursive: true });
    return `Documentos/${FILES_FOLDER}/${name}`;
  }
  download(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: mime }), name);
  return '';
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** Abre el selector de archivos del sistema y devuelve el archivo elegido, o null si se cancela. */
export function pickFile(accept = ''): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Fecha de hoy para nombres de archivo: finanzas-respaldo-2026-10-05. */
export function fileDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Comparte una imagen PNG (llega en base64) con el menú de compartir del teléfono.
 * En el navegador la descarga.
 */
export async function shareImage(name: string, base64: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, files: [uri] });
    return;
  }
  await saveBinaryFile(name, base64, 'image/png');
}
