/**
 * Pure Zod-Schemas + Konstanten für die Library.
 *
 * Bewusst getrennt von `lib/library.ts` (das `node:fs/promises` importiert
 * und damit nicht in Client-Bundles landen kann). Client-Components, die
 * die Types brauchen, ziehen sich diese Datei.
 *
 * `moodTags` und `spotifyGenres` sind free-form Strings — der LLM beim
 * Auto-Tagging entscheidet selbst, welches Vokabular er nutzt. Die einzige
 * Konsistenz-Krücke ist der "existing vocabulary"-Hint im Auto-Tag-Prompt
 * (siehe [app/api/library/auto-tag/route.ts]). Niedrig gehaltene Tag-Länge
 * + lower-case + Trimming als minimaler Normalisierungs-Layer, damit
 * "Peak " und "peak" als derselbe Tag zählen.
 *
 * `spotifyGenres` heißt aus Legacy-Gründen so — Quelle ist nicht mehr nur
 * Spotify, sondern kann auch vom LLM-Tagger befüllt werden (nützlich, weil
 * Spotify Genres im Dev-Mode 403'ed).
 */

import { z } from 'zod';

const TagSchema = z
  .string()
  .min(1)
  .max(40)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => s.length > 0, 'tag must not be blank after trim');

/**
 * Musikalische Tonart in Camelot-Notation (1-12 + A/B, z.B. "8A", "11B") fürs
 * Harmonic Mixing. Anders als moodTags wird hier UPPER-cased normalisiert (das
 * Letter-Suffix ist konventionell groß). Eingabe wird getrimmt + großgeschrieben,
 * dann gegen das Camelot-Format validiert.
 */
const CamelotSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine(
    (s) => /^(1[0-2]|[1-9])[AB]$/.test(s),
    'Camelot key must look like "8A" or "11B" (1-12 + A/B)',
  );

export const LibraryTrackSchema = z.object({
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/),
  title: z.string().min(1),
  artist: z.string().min(1),
  coverUrl: z.string().url().nullable(),
  durationMs: z.number().int().positive(),
  spotifyGenres: z.array(TagSchema),
  bpm: z.number().int().min(40).max(220).nullable(),
  moodTags: z.array(TagSchema),
  energyLevel: z.number().int().min(1).max(10).nullable(),
  /**
   * Camelot-Tonart fürs Harmonic Mixing (z.B. "8A"). Vom Auto-Tag-LLM geschätzt
   * (Spotifys audio-features ist seit Nov 2024 für neue Apps dicht) — also eine
   * Schätzung, kein Messwert. `.default(null)` damit ältere library.json ohne
   * das Feld weiter parst; der Auto-Tag-Run füllt es nachträglich.
   */
  camelotKey: CamelotSchema.nullable().default(null),
  /**
   * Namen der Quell-Playlists, aus denen dieser Track in die Library kam.
   * Free-form Display-Strings (NICHT normalisiert — anders als moodTags/genres,
   * weil das hier echte Playlist-Titel sind, die der Host wiedererkennen soll),
   * dedupliziert. `.default([])` damit ältere library.json ohne das Feld weiter
   * parsen — der Build füllt es nachträglich beim nächsten Import.
   */
  playlists: z.array(z.string().min(1)).default([]),
});

export type LibraryTrack = z.infer<typeof LibraryTrackSchema>;

export const LibrarySchema = z.object({
  builtAt: z.string().datetime().nullable(),
  tracks: z.array(LibraryTrackSchema),
});

export type Library = z.infer<typeof LibrarySchema>;

export function emptyLibrary(): Library {
  return { builtAt: null, tracks: [] };
}
