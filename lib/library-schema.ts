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
