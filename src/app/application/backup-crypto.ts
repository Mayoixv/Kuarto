import { ValidationError } from './errors';

/** Formato del archivo de respaldo. La cabecera va en claro; los datos, cifrados con AES-256-GCM. */
interface BackupFile {
  format: 'finanzas-backup';
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

const ITERATIONS = 310_000;
const enc = new TextEncoder();
/** Por trozos: pasar millones de bytes de una vez a fromCharCode desborda la pila. */
const toB64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromB64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const b64OrNull = (text: unknown) => {
  if (typeof text !== 'string' || !text) return null;
  try {
    return fromB64(text);
  } catch {
    return null;
  }
};
/** Rango aceptado al abrir: todos los respaldos se han creado con 310 000. */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 2_000_000;
/** Ningún respaldo real se acerca a esto; un archivo mayor no se lee entero en memoria. */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

/** PBKDF2-SHA256: el mismo derivado sirve para cifrar respaldos y para el hash del PIN. */
export async function pbkdf2(secret: string, salt: Uint8Array<ArrayBuffer>, iterations = ITERATIONS): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export { fromB64, toB64 };

export async function encryptText(plain: string, password: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', await pbkdf2(password, salt), 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const file: BackupFile = {
    format: 'finanzas-backup',
    version: 1,
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  };
  return JSON.stringify(file);
}

export async function decryptText(fileText: string, password: string): Promise<string> {
  let file: BackupFile;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new ValidationError('notBackup');
  }
  if (file?.format !== 'finanzas-backup' || file.version !== 1) {
    throw new ValidationError('notBackup');
  }
  // La cabecera viene del archivo: un número de iteraciones absurdo congelaría la app antes de pedir nada.
  const salt = b64OrNull(file.salt);
  const iv = b64OrNull(file.iv);
  const data = b64OrNull(file.data);
  const iterationsOk = Number.isInteger(file.iterations) && file.iterations >= MIN_ITERATIONS && file.iterations <= MAX_ITERATIONS;
  if (!iterationsOk || salt?.length !== 16 || iv?.length !== 12 || !data?.length) {
    throw new ValidationError('notBackup');
  }
  const bits = await pbkdf2(password, salt, file.iterations);
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    // AES-GCM no distingue contraseña errónea de archivo alterado; ambos se rechazan sin tocar nada.
    throw new ValidationError('wrongPassword');
  }
}
