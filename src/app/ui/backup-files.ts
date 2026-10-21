import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { BackupData } from '../application/ports/repositories';
import { FILES_FOLDER, fileDate } from './file-io';

/** Carpeta visible en "Mis archivos" del teléfono: Documentos/Kuarto. */
export const AUTO_BACKUP_FOLDER = FILES_FOLDER;
const SAFETY_FOLDER = 'respaldos';
const SAFETY_KEEP = 3;

/** Deja solo los `keep` archivos más nuevos con ese prefijo (el nombre lleva la fecha, así que ordenar por nombre basta). */
async function prune(directory: Directory, folder: string, prefix: string, keep: number) {
  const { files } = await Filesystem.readdir({ path: folder, directory });
  const old = files
    .map((f) => f.name)
    .filter((n) => n.startsWith(prefix))
    .sort()
    .slice(0, -keep);
  for (const name of old) await Filesystem.deleteFile({ path: `${folder}/${name}`, directory });
}

/**
 * Copia de los datos antes de actualizar la base (o de restaurar un respaldo), dentro del almacenamiento privado de
 * la app (sin cifrar, igual que la base misma). Solo en el teléfono.
 */
/** La copia previa va en claro: sin la contraseña del respaldo automático ni los datos del PIN. */
export function withoutSecrets(data: BackupData): BackupData {
  const settings = data.tables['settings']?.filter((r) => {
    const key = String(r['key']);
    return key !== 'auto_backup_password' && !key.startsWith('pin_');
  });
  return settings ? { ...data, tables: { ...data.tables, settings } } : data;
}

export async function saveSafetyCopy(data: BackupData, prefix = 'antes-de-actualizar-'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Filesystem.writeFile({
    path: `${SAFETY_FOLDER}/${prefix}${fileDate()}-v${data.schemaVersion}.json`,
    data: JSON.stringify(withoutSecrets(data)),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await prune(Directory.Data, SAFETY_FOLDER, prefix, SAFETY_KEEP);
}

/** Guarda el respaldo automático (ya cifrado) en Documentos/Kuarto y deja los `keep` más recientes. */
export async function saveAutoBackup(content: string, keep: number): Promise<string> {
  const name = `kuarto-auto-${fileDate()}.finanzas`;
  await Filesystem.writeFile({
    path: `${AUTO_BACKUP_FOLDER}/${name}`,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  await prune(Directory.Documents, AUTO_BACKUP_FOLDER, 'kuarto-auto-', keep);
  return name;
}
