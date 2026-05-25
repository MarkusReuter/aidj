/**
 * Library-Auto-Tagging via LLM (streaming).
 *
 * POST `/api/library/auto-tag` mit `{ uris: string[] }` — fragt das LLM nach
 * `moodTags` + `genres` + `energyLevel` pro Track aus der gespeicherten
 * Library und **streamt** die Vorschläge pro Batch zurück, damit der
 * LibraryEditor live Fortschritt anzeigen kann (sonst sieht der Host bei 200
 * Tracks bis zu eine Minute nur einen Spinner).
 *
 * Wire-Format: `text/event-stream` direkt aus dem POST-Response — der Client
 * liest via `fetch().body.getReader()` + manuellem SSE-Parse. Eigener Job-
 * Registry-Two-Step (wie library-build) lohnt sich nicht: der Auto-Tag-Run
 * dauert Sekunden, ein Reconnect-Pfad wäre Overkill.
 *
 * Event-Typen:
 *   - `progress` — pro abgeschlossenem Batch. Enthält die getaggten Tracks
 *     dieses Batches plus Counter (batchIndex, totalBatches, tagged/total).
 *   - `done` — Abschluss: Summary mit Latenz + Provider + Errors. Stream wird
 *     danach geschlossen.
 *   - `error` — Setup-Fehler vor dem ersten Batch (no_llm_key, invalid_body,
 *     no_tracks). Stream wird danach geschlossen.
 *
 * Provider: derselbe `pickModel()` wie [dj-brain] (Gemini → Anthropic). Ohne
 * Key wird `error: no_llm_key` gestreamt + 200 (nicht 503), damit der Client
 * keinen Sonderpfad braucht.
 *
 * Batching: maximal `BATCH_SIZE` Tracks pro LLM-Call, mehrere Batches
 * sequenziell (nicht parallel — Free-Tier-Rate-Limit-freundlich und kleine
 * Batches = häufigere Progress-Updates).
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import {
  loadLibrary,
  type LibraryTrack,
} from '@/lib/library';
import { pickModel } from '@/lib/llm-provider';

export const dynamic = 'force-dynamic';

/**
 * Sizing für Libraries bis ~2000 Tracks. 25 Tracks/Batch ist bei Gemini 2.5
 * Flash output-tokens-mäßig komfortabel (~50 Token/Track × 25 ≈ 1250, weit
 * unter dem 8K-Output-Limit) und reduziert Roundtrip-Overhead vs. 15er-Batches.
 * Bei 2000 Tracks → 80 Batches → mit Concurrency 10 ≈ 8 Wellen ≈ 1 min total.
 */
const BATCH_SIZE = 25;
const PER_CALL_TIMEOUT_MS = 45_000;
/**
 * Parallel-Worker. Bei paid Gemini Tier 1 (1000+ RPM für 2.5 Flash) ohne
 * Probleme, bei Anthropic Pay-as-you-go ebenfalls. Free-Tier-Gemini (10 RPM)
 * wäre damit sofort tot — wer 2000 Tracks taggen lässt, hat eh paid.
 * 429-Retry unten fängt sporadische Spikes ab.
 */
const CONCURRENCY = 10;
const MAX_429_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1500;
/** Wie viele bereits-vergebene Tags wir dem LLM als Vokabular-Hint mitgeben. */
const VOCAB_HINT_TOP_N = 30;

const RequestSchema = z.object({
  uris: z.array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/)).min(1).max(5000),
});

/**
 * Free-form Schema: das LLM erfindet Mood-Tags und Genres selbst statt aus
 * einer hardcoded Liste zu picken. Konsistenz kommt aus dem Vocabulary-Hint
 * im Prompt — wir zeigen dem Modell, welche Tags die Library schon hat, und
 * bitten es, vorhandene Begriffe zu bevorzugen.
 */
const SuggestionSchema = z.object({
  tracks: z.array(
    z.object({
      uri: z.string(),
      moodTags: z.array(z.string().min(1).max(40)).min(1).max(4),
      genres: z.array(z.string().min(1).max(40)).min(1).max(3),
      energyLevel: z.number().int().min(1).max(10),
    }),
  ),
});

const SYSTEM_PROMPT = `You are a DJ library taxonomist. For each track, propose:

1. moodTags: 1-4 short lower-case tags describing vibe/use-case (e.g. "warm-up", "peak", "afterhours", "feelgood", "melancholic", "banger", "dancefloor", "chill" — or invent new ones if they fit better). Each tag ≤ 40 chars, no whitespace at the edges. Be precise — pick only tags that genuinely apply.
2. genres: 1-3 short lower-case genre labels (e.g. "house", "techno", "indie-pop", "hip-hop", "soul", "ambient"). Use sub-genres if obvious ("deep-house" over "house"). Each tag ≤ 40 chars.
3. energyLevel: 1-10 integer. 1 = ambient/chill background, 5 = solid groove, 8 = peak-time floor-filler, 10 = absolute banger.

**Consistency over creativity.** If a vocabulary-hint section appears below, prefer reusing those existing tags exactly (same spelling, same casing) over inventing near-duplicates. Only coin a new tag when nothing in the existing vocabulary fits.

Use title, artist, BPM, and existing genre tags as signal. Modern dance music (house/techno/EDM) at >124 BPM is usually 7-9 energy. Indie/feelgood pop is 4-6. Ambient/chill is 1-3. Hip-hop varies widely.

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

/**
 * Zählt die bisher vergebenen Tags/Genres über die ganze Library und gibt
 * die top-N je Achse zurück — als Vokabular-Hint im Prompt, damit das LLM
 * "deep-house" wiederverwendet statt jedes Mal "Deep House" / "deephouse"
 * zu erfinden.
 */
function buildVocabularyHint(library: LibraryTrack[]): string {
  const tagCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  for (const t of library) {
    for (const tag of t.moodTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    for (const g of t.spotifyGenres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCAB_HINT_TOP_N)
    .map(([t]) => t);
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCAB_HINT_TOP_N)
    .map(([g]) => g);
  if (topTags.length === 0 && topGenres.length === 0) return '';
  const lines: string[] = ['## Existing vocabulary in library — reuse these exactly when applicable:'];
  if (topTags.length > 0) lines.push(`- moodTags already used: ${topTags.join(', ')}`);
  if (topGenres.length > 0) lines.push(`- genres already used: ${topGenres.join(', ')}`);
  return lines.join('\n');
}

function is429(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; statusCode?: number; message?: string };
  if (e.status === 429 || e.statusCode === 429) return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('quota');
}

async function tagBatch(
  batch: LibraryTrack[],
  vocabularyHint: string,
  modelChoice: ReturnType<typeof pickModel>,
): Promise<SuggestionEntry[]> {
  if (!modelChoice) return [];
  const promptParts = [
    vocabularyHint,
    `Tag these tracks:\n${JSON.stringify(batch.map(trackToPrompt))}`,
  ].filter((p) => p.length > 0);
  const prompt = promptParts.join('\n\n');

  // Retry-Schleife nur für 429 — andere Errors propagieren sofort, damit der
  // Caller pro Batch korrekt in `errors[]` landet statt 30 s zu kreisen.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const result = await Promise.race([
        generateObject({
          model: modelChoice.model,
          schema: SuggestionSchema,
          system: SYSTEM_PROMPT,
          prompt,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), PER_CALL_TIMEOUT_MS)),
      ]);
      if (!result) return [];
      const inputUris = new Set(batch.map((t) => t.uri));
      return result.object.tracks.filter((entry) => inputUris.has(entry.uri));
    } catch (err) {
      lastErr = err;
      if (!is429(err)) throw err;
      console.warn(
        `[auto-tag] 429 on attempt ${attempt + 1}/${MAX_429_RETRIES + 1}, backing off…`,
      );
    }
  }
  throw lastErr;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const choice = pickModel();

  // Body-Parse + Library-Load passieren synchron vor dem Stream-Setup, damit
  // Setup-Fehler sofort als terminales `error`-Event landen statt als HTTP-Code.
  // Client-Code muss dadurch nur einen Pfad lesen.
  let parsedUris: string[] | null = null;
  let parseError: { error: string; message: string } | null = null;
  try {
    const body = await request.json();
    parsedUris = RequestSchema.parse(body).uris;
  } catch (err) {
    parseError = {
      error: 'invalid_body',
      message: err instanceof Error ? err.message : 'Invalid request body',
    };
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          // Stream wurde clientseitig geschlossen — Cleanup läuft via cancel.
        }
      };
      const close = (): void => {
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      if (!choice) {
        emit('error', {
          error: 'no_llm_key',
          message:
            'Kein LLM-Key gesetzt. Setze GOOGLE_GENERATIVE_AI_API_KEY oder ANTHROPIC_API_KEY in .env.local.',
        });
        close();
        return;
      }
      if (parseError) {
        emit('error', parseError);
        close();
        return;
      }
      const library = await loadLibrary();
      const libByUri = new Map(library.tracks.map((t) => [t.uri, t] as const));
      const tracks: LibraryTrack[] = (parsedUris ?? [])
        .map((uri) => libByUri.get(uri))
        .filter((t): t is LibraryTrack => !!t);

      if (tracks.length === 0) {
        emit('error', {
          error: 'no_tracks',
          message: 'Keine der URIs in der Library gefunden.',
        });
        close();
        return;
      }

      const startedAt = Date.now();
      const errors: string[] = [];
      const vocabularyHint = buildVocabularyHint(library.tracks);
      const totalBatches = Math.ceil(tracks.length / BATCH_SIZE);
      let taggedTotal = 0;
      let batchesCompleted = 0;

      /**
       * Worker-Pool: `CONCURRENCY` Worker rennen parallel und greifen sich
       * nacheinander den nächsten Batch via geteiltem `cursor`. Progress wird
       * pro fertigem Batch in der Original-Reihenfolge gezählt (batchIndex
       * stammt aus der Slice-Position, nicht aus der Fertig-Reihenfolge —
       * sonst springt der Counter auf dem Client).
       */
      let cursor = 0;
      const runWorker = async (): Promise<void> => {
        while (true) {
          const i = cursor;
          if (i >= tracks.length) return;
          cursor += BATCH_SIZE;
          const batchIndex = i / BATCH_SIZE;
          const batch = tracks.slice(i, i + BATCH_SIZE);
          let batchTagged: SuggestionEntry[] = [];
          let batchError: string | null = null;
          try {
            batchTagged = await tagBatch(batch, vocabularyHint, choice);
          } catch (err) {
            batchError = err instanceof Error ? err.message : String(err);
            errors.push(`Batch ${batchIndex + 1}: ${batchError}`);
            console.warn(
              `[auto-tag] ${choice.displayName} batch ${batchIndex + 1} failed:`,
              err,
            );
          }
          taggedTotal += batchTagged.length;
          batchesCompleted += 1;
          emit('progress', {
            batchIndex,
            batchesCompleted,
            totalBatches,
            batchSize: batch.length,
            taggedInBatch: batchTagged.length,
            taggedTotal,
            totalTracks: tracks.length,
            tagged: batchTagged,
            error: batchError,
          });
        }
      };

      const workerCount = Math.min(CONCURRENCY, totalBatches);
      await Promise.all(
        Array.from({ length: workerCount }, () => runWorker()),
      );

      const latencyMs = Date.now() - startedAt;
      console.log(
        `[auto-tag] ✓ ${choice.displayName} → ${taggedTotal}/${tracks.length} tracks tagged in ${latencyMs}ms${
          errors.length ? ` (${errors.length} batch error${errors.length === 1 ? '' : 's'})` : ''
        }`,
      );
      emit('done', {
        provider: choice.provider,
        latencyMs,
        requested: tracks.length,
        taggedTotal,
        errors,
      });
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
