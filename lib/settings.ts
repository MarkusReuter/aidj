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
  /**
   * Was der Tablet-/Phone-"Filter"-Button (ehemals nur "Playlists") anzeigt:
   * die Quell-Playlists der Library oder die Genres. `.default` damit ältere
   * settings.json ohne das Feld weiter parsen.
   */
  antiFilterMode: z.enum(['playlists', 'genres']).default('playlists'),
  /**
   * Ob BPM überhaupt eine Rolle spielt: angezeigt (Kandidaten-Karten) UND vom
   * DJ-Brain beim Matchen berücksichtigt. Aus, wenn die BPM-Daten unzuverlässig
   * sind (GetSongBPM-Misses + LLM-Schätzungen) und nur stören. `.default(true)`
   * für ältere settings.json.
   */
  bpmEnabled: z.boolean().default(true),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** Default: 2 h — typische Party-Länge, Tracks fühlen sich frisch an. */
export const DEFAULT_SETTINGS: Settings = {
  cooldownMinutes: 120,
  antiFilterMode: 'playlists',
  bpmEnabled: true,
};

/**
 * Cache auf `globalThis` statt im Modul-Scope — gleiche Begründung wie der
 * State-Stash in `lib/state.ts`: Next.js lädt Server-Module im Dev-Mode teils
 * in mehreren Instanzen (Route-Handler vs. SSE-Stream-Poll). Ein modul-lokales
 * `let cache` würde dann auseinanderlaufen: ein `setSettings()` in der einen
 * Instanz aktualisiert deren Cache + Datei, aber der Poll in der anderen
 * Instanz hat einen eigenen, nie invalidierten Cache und überschreibt die
 * frische Auswahl Sekunden später wieder mit dem alten Wert. Geteilter Cache
 * via globalThis schließt das. Production (`next start`) ist Single-Instance —
 * der Indirect kostet dort nichts.
 */
type SettingsStash = { cache: Settings | null };
const SETTINGS_GLOBAL_KEY = '__aidj_settings_cache__';
const sg = globalThis as typeof globalThis & {
  [SETTINGS_GLOBAL_KEY]?: SettingsStash;
};
if (!sg[SETTINGS_GLOBAL_KEY]) sg[SETTINGS_GLOBAL_KEY] = { cache: null };
const settingsStash = sg[SETTINGS_GLOBAL_KEY]!;

export async function getSettings(): Promise<Settings> {
  if (settingsStash.cache) return settingsStash.cache;
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8');
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    settingsStash.cache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'ENOENT'
    ) {
      settingsStash.cache = { ...DEFAULT_SETTINGS };
    } else {
      // Korrupte Datei o. ä. → Default + Warnung, nicht crashen.
      console.warn('[settings] failed to load, using defaults:', err);
      settingsStash.cache = { ...DEFAULT_SETTINGS };
    }
  }
  return settingsStash.cache;
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
  settingsStash.cache = validated;
  return validated;
}
