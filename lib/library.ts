/**
 * Library Load/Save (Server-Only — importiert `node:fs/promises`).
 *
 * Schemas + Types liegen in `lib/library-schema.ts`, damit Client-Components
 * (z. B. der Library-Editor) die Konstanten/Types ziehen können, ohne dass
 * Turbopack `node:fs/promises` in den Browser-Bundle reinpacken will.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  emptyLibrary,
  LibrarySchema,
  type Library,
} from './library-schema';

export {
  emptyLibrary,
  LibrarySchema,
  LibraryTrackSchema,
  type Library,
  type LibraryTrack,
} from './library-schema';

const LIBRARY_PATH = join(process.cwd(), 'data', 'library.json');

/**
 * Lädt die Library aus `data/library.json`. Wenn die Datei fehlt, gibt es eine
 * leere Library zurück — das ist der Pre-Phase-2-Zustand (noch nichts gebaut).
 */
export async function loadLibrary(): Promise<Library> {
  let raw: string;
  try {
    raw = await readFile(LIBRARY_PATH, 'utf8');
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'ENOENT'
    ) {
      return emptyLibrary();
    }
    throw err;
  }
  return LibrarySchema.parse(JSON.parse(raw));
}

/**
 * Atomic-Write: erst in `library.json.tmp` schreiben, dann atomar umbenennen.
 * Verhindert halb-geschriebene Dateien, falls der Prozess mitten im Schreiben
 * abstürzt (Strom weg, kill -9, …). Standardmuster für single-file-DB-State.
 */
export async function saveLibrary(library: Library): Promise<void> {
  const validated = LibrarySchema.parse(library);
  const dir = dirname(LIBRARY_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = LIBRARY_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  await rename(tmp, LIBRARY_PATH);
}
