/**
 * Library-Auto-Tagging via LLM.
 *
 * POST `/api/library/auto-tag` mit `{ uris: string[] }` — fragt das LLM nach
 * `moodTags` + `energyLevel` pro Track aus der gespeicherten Library und gibt
 * die Vorschläge als Liste zurück. Der Client (LibraryEditor) merged die in
 * seinen lokalen State; persistiert wird erst beim "Speichern".
 *
 * Provider: derselbe `pickModel()` wie [dj-brain] (Gemini → Anthropic). Ohne
 * Key 503 — kein Fallback, anders als beim Brain. Manuelles Taggen bleibt der
 * Weg ohne LLM.
 *
 * Batching: maximal `BATCH_SIZE` Tracks pro LLM-Call, mehrere Batches
 * sequenziell (nicht parallel — Free-Tier-Rate-Limit-freundlich).
 */

import { generateObject } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  loadLibrary,
  MOOD_TAGS,
  type LibraryTrack,
  type MoodTag,
} from '@/lib/library';
import { pickModel } from '@/lib/llm-provider';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 40;
const PER_CALL_TIMEOUT_MS = 30_000;

const RequestSchema = z.object({
  uris: z.array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/)).min(1).max(500),
});

const SuggestionSchema = z.object({
  tracks: z.array(
    z.object({
      uri: z.string(),
      moodTags: z.array(z.enum(MOOD_TAGS)).min(1).max(3),
      energyLevel: z.number().int().min(1).max(10),
    }),
  ),
});

const SYSTEM_PROMPT = `You are a DJ library taxonomist. For each track, suggest:

1. moodTags: 1-3 tags from the allowed enum (warm-up, peak, afterhours, feelgood, melancholic, banger, dancefloor, chill). Be precise — pick only tags that genuinely apply, not "vaguely related" ones.
2. energyLevel: 1-10 integer. 1 = ambient/chill background, 5 = solid groove, 8 = peak-time floor-filler, 10 = absolute banger.

Use title, artist, BPM, and genre tags as signal. Modern dance music (house/techno/EDM) at >124 BPM is usually 7-9 energy. Indie/feelgood pop is 4-6. Ambient/chill is 1-3. Hip-hop varies widely.

Return one entry per input track, matching uris exactly. Do not invent uris.`;

type SuggestionEntry = z.infer<typeof SuggestionSchema>['tracks'][number];

type LibrarySubset = {
  uri: string;
  title: string;
  artist: string;
  bpm: number | null;
  genres: string[];
};

function trackToPrompt(t: LibraryTrack): LibrarySubset {
  return {
    uri: t.uri,
    title: t.title,
    artist: t.artist,
    bpm: t.bpm,
    genres: t.spotifyGenres,
  };
}

async function tagBatch(
  batch: LibraryTrack[],
  modelChoice: ReturnType<typeof pickModel>,
): Promise<SuggestionEntry[]> {
  if (!modelChoice) return [];
  const result = await Promise.race([
    generateObject({
      model: modelChoice.model,
      schema: SuggestionSchema,
      system: SYSTEM_PROMPT,
      prompt: `Tag these tracks:\n${JSON.stringify(batch.map(trackToPrompt))}`,
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PER_CALL_TIMEOUT_MS)),
  ]);
  if (!result) return [];
  const inputUris = new Set(batch.map((t) => t.uri));
  return result.object.tracks.filter((entry) => inputUris.has(entry.uri));
}

export async function POST(request: Request): Promise<Response> {
  const choice = pickModel();
  if (!choice) {
    return NextResponse.json(
      {
        error: 'no_llm_key',
        message:
          'Kein LLM-Key gesetzt. Setze GOOGLE_GENERATIVE_AI_API_KEY oder ANTHROPIC_API_KEY in .env.local.',
      },
      { status: 503 },
    );
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    const body = await request.json();
    parsed = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: err instanceof Error ? err.message : 'Invalid request body',
      },
      { status: 400 },
    );
  }

  const library = await loadLibrary();
  const libByUri = new Map(library.tracks.map((t) => [t.uri, t] as const));
  const tracks: LibraryTrack[] = parsed.uris
    .map((uri) => libByUri.get(uri))
    .filter((t): t is LibraryTrack => !!t);

  if (tracks.length === 0) {
    return NextResponse.json(
      { error: 'no_tracks', message: 'Keine der URIs in der Library gefunden.' },
      { status: 404 },
    );
  }

  const startedAt = Date.now();
  const results: { uri: string; moodTags: MoodTag[]; energyLevel: number }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    try {
      const tagged = await tagBatch(batch, choice);
      results.push(...tagged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i / BATCH_SIZE + 1}: ${msg}`);
      console.warn(`[auto-tag] ${choice.displayName} batch ${i / BATCH_SIZE + 1} failed:`, err);
    }
  }

  const latencyMs = Date.now() - startedAt;
  console.log(
    `[auto-tag] ✓ ${choice.displayName} → ${results.length}/${tracks.length} tracks tagged in ${latencyMs}ms${
      errors.length ? ` (${errors.length} batch error${errors.length === 1 ? '' : 's'})` : ''
    }`,
  );

  return NextResponse.json({
    provider: choice.provider,
    latencyMs,
    requested: tracks.length,
    tagged: results,
    errors,
  });
}
