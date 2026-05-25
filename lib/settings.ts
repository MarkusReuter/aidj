/**
 * Host-Settings (Server-Only). Persistiert in `~/.aidj-app/settings.json` —
 * gleiches Verzeichnis wie der Spotify-Token, gleiches Atomic-Write-Muster
 * (tmp → rename + chmod 0600 auf POSIX).
 *
 * Aktuell nur das Track-Cooldown-Fenster (DJ-Brain darf einen Track nicht
 * vorschlagen, wenn er innerhalb der letzten N Minuten lief). Weitere
 * Host-Settings kommen hier rein, ohne dass die Library angefasst werden muss.
 *
 * In-Memory-Cache, invalidiert beim `setSettings()`. Datei-Lesen passiert nur
 * beim ersten Zugriff nach Server-Boot / nach einer Mutation.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const SETTINGS_PATH = join(homedir(), '.aidj-app', 'settings.json');

export const SettingsSchema = z.object({
  /**
   * Wie lange ein gespielter Track für Brain-Picks gesperrt bleibt. 0 = aus.
   * Obergrenze 12 h verhindert versehentliche "unendlich"-Eingaben, die bei
   * kleinen Libraries den Pool leer machen würden.
   */
  cooldownMinutes: z.number().int().min(0).max(720),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** Default: 2 h — typische Party-Länge, Tracks fühlen sich frisch an. */
export const DEFAULT_SETTINGS: Settings = {
  cooldownMinutes: 120,
};

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    cache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'ENOENT'
    ) {
      cache = { ...DEFAULT_SETTINGS };
    } else {
      // Korrupte Datei o. ä. → Default + Warnung, nicht crashen.
      console.warn('[settings] failed to load, using defaults:', err);
      cache = { ...DEFAULT_SETTINGS };
    }
  }
  return cache;
}

export async function setSettings(next: Settings): Promise<Settings> {
  const validated = SettingsSchema.parse(next);
  const dir = dirname(SETTINGS_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = SETTINGS_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  await rename(tmp, SETTINGS_PATH);
  try {
    await chmod(SETTINGS_PATH, 0o600);
  } catch {
    // Windows ignoriert chmod still.
  }
  cache = validated;
  return validated;
}
