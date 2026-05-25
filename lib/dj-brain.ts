/**
 * DJ-Brain (Phase 5).
 *
 * `proposeNextCandidates()` ist die einzige öffentliche Funktion. Sie liefert
 * 3–4 Track-Kandidaten + optional eine neue Mood-Frage zurück. Caller (state.ts)
 * weiß nicht, ob die Antwort vom LLM oder vom Heuristik-Fallback kommt — beide
 * haben dieselbe Output-Form.
 *
 * Provider-Priorität (siehe `pickModel()` unten):
 *   1. **Google Gemini** — wenn GOOGLE_GENERATIVE_AI_API_KEY gesetzt (Free-Tier-fähig).
 *   2. **Anthropic Claude** — wenn ANTHROPIC_API_KEY gesetzt.
 *   3. **Heuristik-Fallback** — kein Key, LLM-Fehler oder Timeout: BPM-Match ±10,
 *      History-Exclusion, Mood-/Energy-Bias.
 *
 * Wichtig: niemals throwen. Build-/Polling-Loop verlässt sich darauf, dass
 * der Brain immer was zurückgibt — auch wenn das LLM 500't.
 *
 * Server-only.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import type { LibraryTrack } from './library-schema';
import { pickModel } from './llm-provider';
import { MOCK_MOOD_QUESTIONS, type MoodQuestion } from './mock-data';

// ─────────────────────────────────────────────────────────────────────────────
// Public Types.
// ─────────────────────────────────────────────────────────────────────────────

export type BrainCandidate = {
  /** Spotify-URI; muss in der Library existieren. */
  trackUri: string;
  /** LLM-Begründung — intern fürs Debugging/History, nicht aufs Tablet. */
  reasoning: string;
};

export type BrainProvider = 'google' | 'anthropic' | 'heuristic';

export type BrainResult = {
  candidates: BrainCandidate[];
  shouldRefreshMoodQuestion: boolean;
  newMoodQuestion: MoodQuestion | null;
  /** Welcher Pfad hat geantwortet — für SSE-Payload + Admin-Badge. */
  provider: BrainProvider;
  /** Round-Trip-Zeit in ms (0 für Heuristik). */
  latencyMs: number;
};

/** Recency-weighted Aggregat der letzten Button-Klicks. */
export type AggregatedButtonState = {
  /** value → Gewicht (0..1, je jünger desto höher). */
  moodWeights: Record<string, number>;
  /** value → Gewicht. */
  playlistWeights: Record<string, number>;
  /** Aktuelle Track-URIs, die mit 👎 markiert wurden (recency-weighted). */
  dislikedTrackUris: Record<string, number>;
  /** Aktuelle Track-URIs, die mit ❤️ markiert wurden. */
  lovedTrackUris: Record<string, number>;
};

export type BrainInput = {
  /** Library (alle verfügbaren Tracks). */
  library: LibraryTrack[];
  /** Currently playing track (URI). null wenn nichts läuft. */
  currentTrackUri: string | null;
  /** URIs der letzten ~10 gespielten Tracks (neueste zuletzt). */
  history: string[];
  /** Aktive Playlist-Filter (UI-Hints). */
  activePlaylists: string[];
  /** Aktuelle Mood-Frage + Counts. */
  currentMoodQuestion: MoodQuestion | null;
  moodCounts: Record<string, number>;
  /** Aggregierter Button-State (recency-weighted). */
  aggregated: AggregatedButtonState;
  /** Wall-clock-Zeit (für Tageszeit-Hint im Prompt). */
  now: number;
  /** Party-Startzeit (für Energie-Curve-Hint). */
  partyStartedAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Schema fürs LLM-Output.
// ─────────────────────────────────────────────────────────────────────────────

const CandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        trackUri: z.string(),
        reasoning: z.string(),
      }),
    )
    .min(3)
    .max(4),
  shouldRefreshMoodQuestion: z.boolean(),
  newMoodQuestion: z
    .object({
      question: z.string(),
      options: z
        .array(
          z.object({
            emoji: z.string(),
            label: z.string(),
            value: z.string(),
          }),
        )
        .min(3)
        .max(6),
    })
    .nullable()
    .optional(),
});

const DJ_INSTRUCTIONS = `You are an expert party DJ. Propose 3-4 tracks from the library that would each work well as the next song.
Order them by your confidence (first = strongest pick, used as auto-fallback if the crowd doesn't choose).
The candidates should be DIVERSE — different vibes / BPMs / sub-genres — so the crowd has a real choice, not 4 near-duplicates.

Constraints:
- Pick only tracks whose \`uri\` appears in the LIBRARY block. Do not invent URIs.
- Avoid tracks played in the last 10 tracks (in history).
- BPM transition: prefer ±10 BPM from current track when it has BPM; allow deliberate breaks for energy shifts.
- Respect active playlist filters as semantic hints (e.g. "Peak Time" → high energy). Library moodTags + energyLevel are the source of truth.
- Negative signals (recent 👎 on tracks with overlapping tags) should de-rank similar tracks.
- Positive signals (recent ❤️) should boost similar tracks.

If the crowd mood has shifted significantly or the current mood question feels stale (4+ tracks since last refresh), set \`shouldRefreshMoodQuestion: true\` and propose a new \`newMoodQuestion\` with 4-6 options that match the current vibe (e.g. "Energie hoch oder runter?" with energy-related options).

Return your reasoning per candidate concisely — that's for logging, not for the UI.`;

// ─────────────────────────────────────────────────────────────────────────────
// Library-Subset fürs Prompt: kompakt, nur was der LLM braucht.
// ─────────────────────────────────────────────────────────────────────────────

type LibraryPromptEntry = {
  uri: string;
  title: string;
  artist: string;
  bpm: number | null;
  moodTags: string[];
  energyLevel: number | null;
  genres: string[];
};

function libraryForPrompt(lib: LibraryTrack[]): LibraryPromptEntry[] {
  return lib.map((t) => ({
    uri: t.uri,
    title: t.title,
    artist: t.artist,
    bpm: t.bpm,
    moodTags: t.moodTags,
    energyLevel: t.energyLevel,
    genres: t.spotifyGenres,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-Call.
// ─────────────────────────────────────────────────────────────────────────────

async function callLLM(input: BrainInput): Promise<BrainResult | null> {
  const choice = pickModel();
  if (!choice) return null;

  // Prompt-Caching nur bei Anthropic — Gemini ignoriert provider-namespaced
  // Optionen einer anderen Engine, aber wir setzen sie erst gar nicht, um den
  // Wire-Payload sauber zu halten.
  const libraryTextPart =
    choice.provider === 'anthropic'
      ? {
          type: 'text' as const,
          text: `LIBRARY:\n${JSON.stringify(libraryForPrompt(input.library))}`,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' as const } },
          },
        }
      : {
          type: 'text' as const,
          text: `LIBRARY:\n${JSON.stringify(libraryForPrompt(input.library))}`,
        };

  const startedAt = Date.now();
  try {
    const { object } = await generateObject({
      model: choice.model,
      schema: CandidatesSchema,
      // System-Prompt als Top-Level-String (Vercel AI SDK erlaubt für system
      // keine Content-Parts mit providerOptions). Library landet stattdessen
      // als erster User-Block mit cacheControl — Anthropic-Prompt-Caching
      // funktioniert auch über User-Parts.
      system: DJ_INSTRUCTIONS,
      messages: [
        {
          role: 'user' as const,
          content: [
            libraryTextPart,
            {
              type: 'text' as const,
              text:
                `Currently playing: ${input.currentTrackUri ?? 'nothing'}\n` +
                `History (last 10): ${JSON.stringify(input.history)}\n` +
                `Active playlist filters: ${input.activePlaylists.join(', ') || 'none'}\n` +
                `Current mood question + counts: ${JSON.stringify({
                  q: input.currentMoodQuestion,
                  counts: input.moodCounts,
                })}\n` +
                `Aggregated button state (recency-weighted): ${JSON.stringify(input.aggregated)}\n` +
                `Time: ${new Date(input.now).toLocaleTimeString('de-DE')}, party started: ${new Date(input.partyStartedAt).toLocaleTimeString('de-DE')}\n\n` +
                `Now produce candidates per the schema. Pick URIs only from LIBRARY above.`,
            },
          ],
        },
      ],
    });

    const latencyMs = Date.now() - startedAt;

    // URIs gegen die Library validieren — LLM könnte halluzinieren.
    const libUris = new Set(input.library.map((t) => t.uri));
    const validCandidates = object.candidates.filter((c) => libUris.has(c.trackUri));
    if (validCandidates.length < 3) {
      console.warn(
        `[dj-brain] ${choice.displayName} returned ${object.candidates.length} candidates but only ${validCandidates.length} had valid URIs — falling back to heuristic`,
      );
      return null;
    }

    const newMQ =
      object.shouldRefreshMoodQuestion && object.newMoodQuestion
        ? {
            id: `llm-${Date.now()}`,
            question: object.newMoodQuestion.question,
            options: object.newMoodQuestion.options,
          }
        : null;

    console.log(
      `[dj-brain] ✓ ${choice.displayName} → ${validCandidates.length} candidates in ${latencyMs}ms${newMQ ? ' + new mood question' : ''}`,
    );

    return {
      candidates: validCandidates.slice(0, 4),
      shouldRefreshMoodQuestion: object.shouldRefreshMoodQuestion && newMQ !== null,
      newMoodQuestion: newMQ,
      provider: choice.provider,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    console.warn(
      `[dj-brain] ✗ ${choice.displayName} failed after ${latencyMs}ms, falling back to heuristic:`,
      err,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristik-Fallback (kein API-Key oder LLM-Fehler).
// ─────────────────────────────────────────────────────────────────────────────

function heuristicCandidates(input: BrainInput, count: number): BrainCandidate[] {
  const historySet = new Set(input.history);
  if (input.currentTrackUri) historySet.add(input.currentTrackUri);

  const currentBpm =
    input.library.find((t) => t.uri === input.currentTrackUri)?.bpm ?? null;

  // Pool: alles aus der Library, was nicht gerade gespielt wurde.
  const pool = input.library.filter((t) => !historySet.has(t.uri));
  if (pool.length === 0) return [];

  // Scoring: BPM-Distanz + Dislike-Penalty + Love-Boost. Höher = besser.
  function score(t: LibraryTrack): number {
    let s = 1.0;
    if (currentBpm !== null && t.bpm !== null) {
      const dist = Math.abs(t.bpm - currentBpm);
      // ±10 BPM volle Punkte, dahinter Abfall.
      s += Math.max(0, 1.5 - dist / 10);
    }
    // Dislikes überwiegen Love (sonst eskaliert ein Tag in eine Richtung).
    for (const [uri, w] of Object.entries(input.aggregated.dislikedTrackUris)) {
      if (uri === t.uri) s -= 2 * w;
      // Tag-Overlap downweight.
      const dislikedTrack = input.library.find((x) => x.uri === uri);
      if (dislikedTrack) {
        const overlap = dislikedTrack.moodTags.filter((tag) =>
          t.moodTags.includes(tag),
        ).length;
        s -= 0.3 * w * overlap;
      }
    }
    for (const [uri, w] of Object.entries(input.aggregated.lovedTrackUris)) {
      const lovedTrack = input.library.find((x) => x.uri === uri);
      if (lovedTrack) {
        const overlap = lovedTrack.moodTags.filter((tag) =>
          t.moodTags.includes(tag),
        ).length;
        s += 0.2 * w * overlap;
      }
    }
    // Random-Jitter, damit die Auswahl nicht immer dieselbe ist.
    s += Math.random() * 0.3;
    return s;
  }

  const scored = pool
    .map((t) => ({ t, s: score(t) }))
    .sort((a, b) => b.s - a.s);

  return scored.slice(0, count).map((x) => ({
    trackUri: x.t.uri,
    reasoning: `heuristic: bpm-match=${
      currentBpm && x.t.bpm ? Math.abs(x.t.bpm - currentBpm) : 'n/a'
    } moodTags=${x.t.moodTags.join(',')}`,
  }));
}

function heuristicMoodRefresh(
  currentQ: MoodQuestion | null,
  tracksSinceRefresh: number,
): { shouldRefreshMoodQuestion: boolean; newMoodQuestion: MoodQuestion | null } {
  if (tracksSinceRefresh < 4 || MOCK_MOOD_QUESTIONS.length === 0) {
    return { shouldRefreshMoodQuestion: false, newMoodQuestion: null };
  }
  // Rotiere durch die statischen Fragen.
  const currentIdx = MOCK_MOOD_QUESTIONS.findIndex((q) => q.id === currentQ?.id);
  const nextIdx = (currentIdx + 1) % MOCK_MOOD_QUESTIONS.length;
  return {
    shouldRefreshMoodQuestion: true,
    newMoodQuestion: MOCK_MOOD_QUESTIONS[nextIdx] ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: proposeNextCandidates.
// ─────────────────────────────────────────────────────────────────────────────

export async function proposeNextCandidates(
  input: BrainInput,
  opts: { count?: number; tracksSinceRefresh?: number } = {},
): Promise<BrainResult> {
  const count = opts.count ?? 4;
  const tracksSinceRefresh = opts.tracksSinceRefresh ?? 0;

  // 1. Versuche LLM (asynchron, mit Timeout).
  const llm = await Promise.race([
    callLLM(input),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  if (llm) return llm;

  // 2. Fallback: heuristische Auswahl + statische Mood-Rotation.
  const candidates = heuristicCandidates(input, count);
  const mood = heuristicMoodRefresh(input.currentMoodQuestion, tracksSinceRefresh);
  return {
    candidates,
    shouldRefreshMoodQuestion: mood.shouldRefreshMoodQuestion,
    newMoodQuestion: mood.newMoodQuestion,
    provider: 'heuristic',
    latencyMs: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Button-Aggregation (recency-weighted).
// ─────────────────────────────────────────────────────────────────────────────

export type ButtonLogEntry = {
  timestamp: number;
  type: 'mood' | 'playlist' | 'dislike' | 'love';
  value: string;
  /** Bei dislike/love: die URI des Tracks, der zum Zeitpunkt des Klicks lief. */
  trackUri?: string;
};

/** Halbwertszeit der Recency-Gewichtung in Millisekunden (3 Min). */
const HALF_LIFE_MS = 3 * 60 * 1000;

function recencyWeight(timestamp: number, now: number): number {
  const ageMs = Math.max(0, now - timestamp);
  // Exponential decay: weight = 0.5^(age / half-life).
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

export function aggregateButtonLog(
  log: ButtonLogEntry[],
  now: number,
): AggregatedButtonState {
  const moodWeights: Record<string, number> = {};
  const playlistWeights: Record<string, number> = {};
  const dislikedTrackUris: Record<string, number> = {};
  const lovedTrackUris: Record<string, number> = {};
  for (const e of log) {
    const w = recencyWeight(e.timestamp, now);
    if (w < 0.01) continue; // negligible
    switch (e.type) {
      case 'mood':
        moodWeights[e.value] = (moodWeights[e.value] ?? 0) + w;
        break;
      case 'playlist':
        playlistWeights[e.value] = (playlistWeights[e.value] ?? 0) + w;
        break;
      case 'dislike':
        if (e.trackUri)
          dislikedTrackUris[e.trackUri] = (dislikedTrackUris[e.trackUri] ?? 0) + w;
        break;
      case 'love':
        if (e.trackUri)
          lovedTrackUris[e.trackUri] = (lovedTrackUris[e.trackUri] ?? 0) + w;
        break;
    }
  }
  return { moodWeights, playlistWeights, dislikedTrackUris, lovedTrackUris };
}
