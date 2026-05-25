/**
 * Server-Side Party-State (Singleton, In-Memory).
 *
 * Pub-Sub:
 *   subscribe(handler) → unsubscribe(). Erster Subscriber startet das
 *   Spotify-Polling, letzter stoppt es — so macht die App ohne verbundene
 *   Tablets nichts und feuert keine API-Calls.
 *
 * Persistenz: keine. Während der Party MUSS die App im Production-Mode
 * (`next start`) laufen — Dev-HMR würde State und Polling-Interval wegwerfen.
 *
 * Phase 4 deckt: Now-Playing-Polling, Kandidaten aus Library, Button-State,
 * Playlist-Toggles, Mood-Question-Rotation. Phase 4a (Gast-Queue) und Phase 5
 * (LLM-Kandidaten) hängen sich später hier ein, ohne dass Konsumenten brechen.
 */

import { EventEmitter } from 'node:events';
import {
  enqueue as guestEnqueue,
  listActive as listActiveGuests,
  markDone as guestMarkDone,
  markPlaying as guestMarkPlaying,
  rollback as guestRollback,
  type EnqueueResult,
  type GuestEntry,
} from './guest-queue';
import { loadLibrary, type LibraryTrack } from './library';
import { MOCK_MOOD_QUESTIONS, type MoodQuestion } from './mock-data';
import type {
  SnapshotBrainStatus,
  SnapshotTrack,
  StateSnapshot,
} from './server-state-types';
import {
  addToQueue,
  getCurrentTrack,
  getDevices,
  isConnected as isSpotifyConnected,
  skipToNext,
  SpotifyNotConnectedError,
  type NowPlaying,
} from './spotify';
import {
  aggregateButtonLog,
  proposeNextCandidates,
  type ButtonLogEntry,
} from './dj-brain';

const POLL_INTERVAL_MS = 5_000;
const CANDIDATE_COUNT = 4;
const TRACKS_PER_MOOD_QUESTION = 4;
const DEFAULT_BPM = 120;
/** Wenn weniger Restzeit als das im aktuellen Track ist, pushen wir den Auto-Pick in die Spotify-Queue. */
const LOCK_WINDOW_MS = 10_000;
/** Maximale Anzahl Button-Events im Log (Recency-Weighting macht ältere irrelevant). */
const BUTTON_LOG_MAX = 200;
/** History-Größe für DJ-Brain (letzte gespielte Tracks). */
const HISTORY_MAX = 10;

type InternalState = {
  spotifyConnected: boolean;
  activeDeviceId: string | null;
  deviceName: string | null;
  nowPlaying: NowPlaying;
  /** Zeitstempel des letzten Polls, zum Interpolieren der Progress-Bar. */
  pollAt: number;
  candidates: SnapshotTrack[];
  /** Brain-Reasoning pro Candidate (für /history-View; nicht in den Snapshot). */
  candidateReasonings: Record<string, string>;
  committedId: string | null;
  /** URI, die im Lock-Window an Spotify gequeued wurde. Verhindert Doppel-Push. */
  lockedTrackUri: string | null;
  moodCounts: Record<string, number>;
  moodQuestionIdx: number;
  tracksUntilMoodSwitch: number;
  /** Vom DJ-Brain dynamisch erzeugte Frage, die `moodQuestionIdx` überschreibt. */
  customMoodQuestion: MoodQuestion | null;
  activePlaylists: Set<string>;
  /** URI des zuletzt gesehenen Tracks — Edge-Detect für Track-Wechsel. */
  lastTrackUri: string | null;
  /** Letzte HISTORY_MAX URIs (neueste zuletzt). */
  history: string[];
  /** Wall-clock-Zeit des ersten Tracks der Session (für LLM-Energie-Curve-Hint). */
  partyStartedAt: number;
  /** Rolling Log der Button-Klicks für recency-weighted Aggregation. */
  buttonLog: ButtonLogEntry[];
  /** Letzter DJ-Brain-Status (Provider + Latenz); für Admin-Badge via SSE. */
  lastBrain: SnapshotBrainStatus | null;
};

const state: InternalState = {
  spotifyConnected: false,
  activeDeviceId: null,
  deviceName: null,
  nowPlaying: null,
  pollAt: Date.now(),
  candidates: [],
  candidateReasonings: {},
  committedId: null,
  lockedTrackUri: null,
  moodCounts: {},
  moodQuestionIdx: 0,
  tracksUntilMoodSwitch: TRACKS_PER_MOOD_QUESTION,
  customMoodQuestion: null,
  activePlaylists: new Set<string>(),
  lastTrackUri: null,
  history: [],
  partyStartedAt: Date.now(),
  buttonLog: [],
  lastBrain: null,
};

const emitter = new EventEmitter();
// In Theorie unbegrenzt; bei vielen Tablets schreit Node sonst.
emitter.setMaxListeners(50);

let subscriberCount = 0;
let pollTimer: NodeJS.Timeout | null = null;
let libraryCache: LibraryTrack[] | null = null;

function libraryToSnapshotTrack(t: LibraryTrack): SnapshotTrack {
  return {
    id: t.uri,
    title: t.title,
    artist: t.artist,
    coverUrl:
      t.coverUrl ?? 'https://via.placeholder.com/600x600.png?text=No+Cover',
    bpm: t.bpm ?? DEFAULT_BPM,
    durationMs: t.durationMs,
    genre: t.spotifyGenres[0] ?? '',
  };
}

function spotifyNowPlayingToTrack(
  np: NonNullable<NowPlaying>,
  enrichedFromLibrary?: LibraryTrack,
): SnapshotTrack {
  return {
    id: np.track.uri,
    title: np.track.name,
    artist: np.track.artists.join(', '),
    coverUrl:
      np.track.coverUrl ??
      enrichedFromLibrary?.coverUrl ??
      'https://via.placeholder.com/600x600.png?text=No+Cover',
    bpm: enrichedFromLibrary?.bpm ?? DEFAULT_BPM,
    durationMs: np.track.durationMs,
    genre: enrichedFromLibrary?.spotifyGenres[0] ?? '',
  };
}

async function getLibrary(): Promise<LibraryTrack[]> {
  if (libraryCache) return libraryCache;
  const lib = await loadLibrary();
  libraryCache = lib.tracks;
  return libraryCache;
}

/**
 * Wirft Cache weg — wird vom Library-Editor aufgerufen, wenn der Host während
 * der App-Lifetime Tags umschreibt. Für Phase 4 noch nicht verdrahtet, bleibt
 * aber als Hook für Phase 6.
 */
export function invalidateLibraryCache(): void {
  libraryCache = null;
}

/**
 * Holt sich neue Kandidaten vom DJ-Brain (Phase 5). Brain entscheidet intern,
 * ob LLM oder Heuristik — beide Pfade liefern dieselbe Output-Form. Updated
 * auch ggf. die Mood-Frage (LLM kann `shouldRefreshMoodQuestion` setzen).
 *
 * Niemals throwen: bei totalen Brain-Ausfall (sollte mit dem internen
 * Fallback nie passieren) leeres Candidate-Array statt Crash.
 */
async function pickCandidatesViaBrain(
  library: LibraryTrack[],
  currentUri: string | null,
): Promise<{ candidates: SnapshotTrack[]; reasonings: Record<string, string> }> {
  try {
    const result = await proposeNextCandidates(
      {
        library,
        currentTrackUri: currentUri,
        history: state.history.slice(-HISTORY_MAX),
        activePlaylists: [...state.activePlaylists],
        currentMoodQuestion:
          state.customMoodQuestion ?? currentMoodQuestion() ?? null,
        moodCounts: state.moodCounts,
        aggregated: aggregateButtonLog(state.buttonLog, Date.now()),
        now: Date.now(),
        partyStartedAt: state.partyStartedAt,
      },
      {
        count: CANDIDATE_COUNT,
        tracksSinceRefresh:
          TRACKS_PER_MOOD_QUESTION - state.tracksUntilMoodSwitch,
      },
    );

    // Brain hat eine neue Mood-Frage vorgeschlagen → übernehmen + Counts reset.
    if (result.shouldRefreshMoodQuestion && result.newMoodQuestion) {
      state.customMoodQuestion = result.newMoodQuestion;
      state.moodCounts = {};
      state.tracksUntilMoodSwitch = TRACKS_PER_MOOD_QUESTION;
    }

    state.lastBrain = {
      provider: result.provider,
      latencyMs: result.latencyMs,
      at: Date.now(),
    };

    const candidates: SnapshotTrack[] = [];
    const reasonings: Record<string, string> = {};
    for (const c of result.candidates) {
      const t = library.find((x) => x.uri === c.trackUri);
      if (!t) continue;
      const snapshot = libraryToSnapshotTrack(t);
      candidates.push(snapshot);
      reasonings[snapshot.id] = c.reasoning;
    }
    return { candidates, reasonings };
  } catch (err) {
    console.warn('[state] dj-brain crashed unexpectedly:', err);
    return { candidates: [], reasonings: {} };
  }
}

function currentMoodQuestion(): MoodQuestion | undefined {
  if (state.customMoodQuestion) return state.customMoodQuestion;
  if (MOCK_MOOD_QUESTIONS.length === 0) return undefined;
  return MOCK_MOOD_QUESTIONS[state.moodQuestionIdx % MOCK_MOOD_QUESTIONS.length];
}

function buildSnapshot(): StateSnapshot {
  const np = state.nowPlaying;
  const mq = currentMoodQuestion();
  let track: SnapshotTrack | null = null;
  if (np) {
    const enriched = libraryCache?.find((t) => t.uri === np.track.uri);
    track = spotifyNowPlayingToTrack(np, enriched);
  }
  return {
    snapshotAt: Date.now(),
    spotify: state.spotifyConnected
      ? {
          connected: true,
          activeDeviceId: state.activeDeviceId,
          deviceName: state.deviceName,
        }
      : { connected: false },
    currentTrack: track,
    progressMs: np?.progressMs ?? 0,
    isPlaying: np?.isPlaying ?? false,
    candidates: state.candidates,
    committedId: state.committedId,
    currentMoodQuestion: mq ?? null,
    moodCounts: { ...state.moodCounts },
    activePlaylists: [...state.activePlaylists],
    guestQueue: listActiveGuests().map((e) => ({
      guestId: e.guestId,
      guestName: e.guestName,
      trackUri: e.trackUri,
      trackMeta: e.trackMeta,
      submissionId: e.submissionId,
      submittedAt: e.submittedAt,
      status: e.status,
    })),
    brain: state.lastBrain,
  };
}

function emit(): void {
  emitter.emit('snapshot', buildSnapshot());
}

/**
 * Pollt Spotify und reagiert auf Änderungen:
 * - Track gewechselt → Kandidaten neu picken, Mood-Question ggf. rotieren,
 *   committedId zurücksetzen.
 * - Connect verloren → State auf disconnected setzen, Polling läuft weiter.
 */
async function poll(): Promise<void> {
  state.pollAt = Date.now();
  try {
    if (!(await isSpotifyConnected())) {
      state.spotifyConnected = false;
      state.nowPlaying = null;
      state.activeDeviceId = null;
      state.deviceName = null;
      emit();
      return;
    }
    state.spotifyConnected = true;
    const [np, devices] = await Promise.all([
      getCurrentTrack().catch(() => null),
      getDevices().catch(() => [] as Awaited<ReturnType<typeof getDevices>>),
    ]);
    state.nowPlaying = np;
    const activeDevice = devices.find((d) => d.is_active) ?? null;
    state.activeDeviceId = activeDevice?.id ?? null;
    state.deviceName = activeDevice?.name ?? null;

    const currentUri = np?.track.uri ?? null;

    if (currentUri !== state.lastTrackUri) {
      // ── Track-Wechsel: Pipeline durchspülen. ───────────────────────────
      // Wenn das der erste Track der Session ist, setzen wir die Party-Startzeit
      // jetzt — server-boot war evtl. Stunden früher.
      if (state.lastTrackUri === null && currentUri !== null) {
        state.partyStartedAt = Date.now();
      }
      if (state.lastTrackUri) {
        guestMarkDone(state.lastTrackUri);
        // History tracking — den vorigen Track ans Ende der History hängen.
        state.history.push(state.lastTrackUri);
        if (state.history.length > HISTORY_MAX * 2) {
          state.history = state.history.slice(-HISTORY_MAX);
        }
      }
      if (currentUri) guestMarkPlaying(currentUri);

      state.committedId = null;
      state.lockedTrackUri = null;
      state.lastTrackUri = currentUri;
      state.tracksUntilMoodSwitch -= 1;
      // Statische Rotation greift nur, wenn der Brain keine eigene Frage gesetzt hat.
      if (
        state.tracksUntilMoodSwitch <= 0 &&
        state.customMoodQuestion === null
      ) {
        state.moodQuestionIdx += 1;
        state.moodCounts = {};
        state.tracksUntilMoodSwitch = TRACKS_PER_MOOD_QUESTION;
      }

      // Brain anrufen — entscheidet selbst, ob LLM oder Heuristik.
      const library = await getLibrary();
      const picked = await pickCandidatesViaBrain(library, currentUri);
      state.candidates = picked.candidates;
      state.candidateReasonings = picked.reasonings;
    }

    // ── Lock-Window: ~10s vor Track-Ende den Auto-Pick in Spotify-Queue pushen.
    // Verwendet die committed-Wahl (Tablet-Tap) wenn vorhanden, sonst Top-Brain-Pick.
    if (
      np &&
      currentUri &&
      state.lockedTrackUri === null &&
      np.track.durationMs - np.progressMs <= LOCK_WINDOW_MS &&
      np.track.durationMs - np.progressMs > 0
    ) {
      const pickUri =
        state.committedId ?? state.candidates[0]?.id ?? null;
      // Nicht Lock-Pushen wenn der Pick gerade selbst der laufende Track ist
      // (paranoid; sollte nicht passieren, weil Kandidaten den laufenden ausschließen).
      if (pickUri && pickUri !== currentUri) {
        try {
          await addToQueue(pickUri);
          state.lockedTrackUri = pickUri;
        } catch (err) {
          // Häufigster Fehler: kein aktives Device → Lock einfach skippen.
          console.warn('[state] lock-window addToQueue failed:', err);
        }
      }
    }
  } catch (err) {
    // Polling-Fehler nicht propagieren — Tablet bleibt am letzten Snapshot
    // hängen statt der App-Lifecycle zu killen.
    console.warn('[state] poll error:', err);
  }
  emit();
}

function startPolling(): void {
  if (pollTimer) return;
  // Erster Poll sofort, damit der erste Subscriber nicht 5 s leeren State sieht.
  void poll();
  pollTimer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export type SnapshotHandler = (snapshot: StateSnapshot) => void;

/**
 * Subscribed einen Handler auf Snapshot-Events. Startet das Spotify-Polling
 * bei der ersten Subscription und stoppt es bei der letzten Unsubscription.
 * Liefert direkt den aktuellen Snapshot synchron zurück, damit der Caller
 * nicht auf den nächsten Poll warten muss.
 */
export function subscribe(handler: SnapshotHandler): {
  unsubscribe: () => void;
  initialSnapshot: StateSnapshot;
} {
  emitter.on('snapshot', handler);
  subscriberCount += 1;
  if (subscriberCount === 1) {
    startPolling();
  }
  const initial = buildSnapshot();
  let active = true;
  return {
    initialSnapshot: initial,
    unsubscribe: () => {
      if (!active) return;
      active = false;
      emitter.off('snapshot', handler);
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        stopPolling();
      }
    },
  };
}

// Mutation-API für die /api/state/*-Routen.

function logButton(entry: Omit<ButtonLogEntry, 'timestamp'>): void {
  state.buttonLog.push({
    ...entry,
    timestamp: Date.now(),
    // Mood-/Playlist-Klicks bekommen den aktuell laufenden Track für die
    // /history-Page; die anti-Variante hat die URI schon selbst (siehe Caller).
    trackUri: entry.trackUri ?? state.lastTrackUri ?? undefined,
  });
  if (state.buttonLog.length > BUTTON_LOG_MAX) {
    state.buttonLog = state.buttonLog.slice(-BUTTON_LOG_MAX);
  }
}

/**
 * Read-Only Read-Out vom Button-Log für die /history-Page. Schließt die
 * lib/state.ts-Internals von der Page ab.
 */
export function getButtonLog(): ReadonlyArray<ButtonLogEntry> {
  return state.buttonLog.slice();
}

export function getPlayHistory(): ReadonlyArray<string> {
  return state.history.slice();
}

export function getPartyStartedAt(): number {
  return state.partyStartedAt;
}

export function recordMoodPress(value: string): void {
  state.moodCounts[value] = (state.moodCounts[value] ?? 0) + 1;
  logButton({ type: 'mood', value });
  // Massive Stimmungs-Shift: 5+ Klicks auf denselben Mood-Wert in den letzten
  // 30 s → Brain neu fragen lassen (re-rank), damit die Kandidaten zur neuen
  // Stimmung passen statt zur alten.
  if (shouldTriggerReRank('mood', value)) {
    void reRankAsync('mood-shift');
  }
  emit();
}

function shouldTriggerReRank(type: 'mood' | 'anti', value: string): boolean {
  const cutoff = Date.now() - 30_000;
  const relevant = state.buttonLog.filter(
    (e) => e.timestamp >= cutoff && e.type === type && e.value === value,
  );
  return relevant.length >= 5;
}

async function reRankAsync(reason: string): Promise<void> {
  if (!state.lastTrackUri) return;
  try {
    const library = await getLibrary();
    const picked = await pickCandidatesViaBrain(library, state.lastTrackUri);
    state.candidates = picked.candidates;
    state.candidateReasonings = picked.reasonings;
    // Wenn die committed-Wahl nicht mehr in den neuen Kandidaten ist, freigeben.
    if (
      state.committedId &&
      !picked.candidates.some((c) => c.id === state.committedId)
    ) {
      state.committedId = null;
    }
    emit();
    console.log(`[state] re-ranked candidates (reason: ${reason})`);
  } catch (err) {
    console.warn('[state] re-rank failed:', err);
  }
}

export function togglePlaylist(name: string): void {
  if (state.activePlaylists.has(name)) state.activePlaylists.delete(name);
  else state.activePlaylists.add(name);
  logButton({ type: 'playlist', value: name });
  emit();
}

export function commitCandidate(trackId: string): boolean {
  const exists = state.candidates.some((c) => c.id === trackId);
  if (!exists) return false;
  state.committedId = trackId;
  emit();
  return true;
}

export type SubmitGuestResult =
  | { ok: true; entry: GuestEntry; position: number; deduped: boolean }
  | { ok: false; error: 'quota_exceeded'; current: GuestEntry }
  | { ok: false; error: 'queue_full' }
  | { ok: false; error: 'not_connected'; message: string }
  | { ok: false; error: 'no_active_device'; message: string }
  | { ok: false; error: 'spotify_error'; message: string };

/**
 * Submit eines Gast-Track-Wunschs. Geht durch:
 *   1. Quota/Idempotency-Check in guest-queue.enqueue (mutex)
 *   2. Spotify-addToQueue: lässt den Track ans Ende der Connect-Queue
 *      hängen, sodass er nach allen schon gequeueten Tracks läuft.
 *   3. Bei Spotify-Fehler → rollback aus der Gast-Queue, damit der Gast
 *      direkt neu submitten kann (z.B. nachdem das Device aktiv wurde).
 *
 * Phase-4a-Vereinfachung: "Submit = sofort Spotify-Queue". Lock-Window
 * vor Track-Ende kommt mit Phase 5 (DJ-Brain) — dann wandert der
 * eigentliche Queue-Push dort hin und Phase 4a's Submit befüllt nur
 * noch die Gast-Queue.
 */
export async function submitGuestTrack(input: {
  guestId: string;
  guestName: string;
  trackUri: string;
  trackMeta: GuestEntry['trackMeta'];
  submissionId: string;
}): Promise<SubmitGuestResult> {
  const queued: EnqueueResult = await guestEnqueue(input);
  if (!queued.ok) {
    emit(); // Snapshot fürs UI ist trotzdem fresh.
    return queued;
  }
  // Idempotency-Hit → Spotify-Call schon beim ersten Mal gelaufen,
  // nicht doppelt feuern.
  if (queued.deduped) {
    emit();
    return { ok: true, entry: queued.entry, position: queued.position, deduped: true };
  }
  try {
    await addToQueue(input.trackUri);
  } catch (err) {
    await guestRollback(input.submissionId);
    emit();
    if (err instanceof SpotifyNotConnectedError) {
      return { ok: false, error: 'not_connected', message: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Kein aktives Spotify-Device')) {
      return { ok: false, error: 'no_active_device', message: msg };
    }
    return { ok: false, error: 'spotify_error', message: msg };
  }
  emit();
  return { ok: true, entry: queued.entry, position: queued.position, deduped: false };
}

/**
 * Anti-Buttons (👎 / ❤️). Beide werden im Button-Log mit der aktuellen Track-URI
 * verknüpft, damit der DJ-Brain Tag-Overlap-Penalties/-Boosts berechnen kann.
 *
 * `dislike` triggert sofort einen Re-Rank — der Crowd sagt aktiv "nicht das",
 * also wollen wir die ähnlichen Tracks aus den aktuellen Kandidaten ranauswerfen.
 */
const antiCounts = { dislike: 0, love: 0 };
export function recordAntiPress(value: 'dislike' | 'love'): void {
  antiCounts[value] += 1;
  const trackUri = state.lastTrackUri ?? undefined;
  logButton({ type: value, value, trackUri });
  if (value === 'dislike') {
    void reRankAsync('dislike');
  }
  emit();
}
export function getAntiCounts(): Readonly<typeof antiCounts> {
  return antiCounts;
}

/**
 * Skip-Track: drückt Spotify-Next + räumt Gast-Queue auf + triggert
 * Brain-Re-Rank für den Slot danach. Idempotent gegen Doppel-Skip — Spotify
 * gibt einfach erneut "next" zurück, was im Worst-Case einen Track weiter
 * vorne überspringt; wir akzeptieren das als Edge-Case.
 */
export type SkipResult =
  | { ok: true }
  | { ok: false; error: 'not_connected' | 'no_active_device' | 'spotify_error'; message: string };

export async function skipCurrentTrack(): Promise<SkipResult> {
  try {
    await skipToNext(state.activeDeviceId ?? undefined);
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return { ok: false, error: 'not_connected', message: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Kein aktives Spotify-Device')) {
      return { ok: false, error: 'no_active_device', message: msg };
    }
    return { ok: false, error: 'spotify_error', message: msg };
  }
  // Gast-Queue-Lifecycle: der weggekippte Track ist (falls Gast) erledigt.
  if (state.lastTrackUri) guestMarkDone(state.lastTrackUri);
  // Pollen wird beim nächsten Tick den Track-Wechsel sehen + neue Kandidaten holen.
  // Wir emitten direkt einmal, damit das UI sofort reagiert (z.B. Skip-Toast).
  emit();
  return { ok: true };
}

export function getSnapshot(): StateSnapshot {
  return buildSnapshot();
}
