/**
 * Pure Zod-Schemas + Konstanten für die Library.
 *
 * Bewusst getrennt von `lib/library.ts` (das `node:fs/promises` importiert
 * und damit nicht in Client-Bundles landen kann). Client-Components, die
 * `MOOD_TAGS` oder die Types brauchen, ziehen sich diese Datei.
 */

import { z } from 'zod';

/**
 * Erlaubtes Mood-Tag-Vokabular. Bewusst kurz gehalten — pro Track 0..n davon,
 * der DJ-Brain in Phase 5 nutzt sie als semantische Hints. Erweiterbar, aber
 * jede Erweiterung muss in den DJ-Prompt zurückfließen (sonst toter Tag).
 */
export const MOOD_TAGS = [
  'warm-up',
  'peak',
  'afterhours',
  'feelgood',
  'melancholic',
  'banger',
  'dancefloor',
  'chill',
] as const;

export type MoodTag = (typeof MOOD_TAGS)[number];

export const LibraryTrackSchema = z.object({
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/),
  title: z.string().min(1),
  artist: z.string().min(1),
  coverUrl: z.string().url().nullable(),
  durationMs: z.number().int().positive(),
  spotifyGenres: z.array(z.string()),
  bpm: z.number().int().min(40).max(220).nullable(),
  moodTags: z.array(z.enum(MOOD_TAGS)),
  energyLevel: z.number().int().min(1).max(10).nullable(),
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
