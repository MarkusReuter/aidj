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
import { loadLibrary, type LibraryTrack } from './library';
import { MOCK_MOOD_QUESTIONS, type MoodQuestion } from './mock-data';
import type { SnapshotTrack, StateSnapshot } from './server-state-types';
import {
  getCurrentTrack,
  getDevices,
  isConnected as isSpotifyConnected,
  type NowPlaying,
} from './spotify';

const POLL_INTERVAL_MS = 5_000;
const CANDIDATE_COUNT = 4;
const TRACKS_PER_MOOD_QUESTION = 4;
const DEFAULT_BPM = 120;

type InternalState = {
  spotifyConnected: boolean;
  activeDeviceId: string | null;
  deviceName: string | null;
  nowPlaying: NowPlaying;
  /** Zeitstempel des letzten Polls, zum Interpolieren der Progress-Bar. */
  pollAt: number;
  candidates: SnapshotTrack[];
  committedId: string | null;
  moodCounts: Record<string, number>;
  moodQuestionIdx: number;
  tracksUntilMoodSwitch: number;
  activePlaylists: Set<string>;
  /** URI des zuletzt gesehenen Tracks — Edge-Detect für Track-Wechsel. */
  lastTrackUri: string | null;
};

const state: InternalState = {
  spotifyConnected: false,
  activeDeviceId: null,
  deviceName: null,
  nowPlaying: null,
  pollAt: Date.now(),
  candidates: [],
  committedId: null,
  moodCounts: {},
  moodQuestionIdx: 0,
  tracksUntilMoodSwitch: TRACKS_PER_MOOD_QUESTION,
  activePlaylists: new Set<string>(),
  lastTrackUri: null,
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
 * Wählt CANDIDATE_COUNT Tracks aus der Library, exkl. der aktuell spielende.
 * Phase 4 stand-in für den DJ-Brain — pure Random-Auswahl, kein BPM-/Mood-
 * Matching. Wird in Phase 5 durch `proposeNextCandidates()` ersetzt.
 */
function pickCandidatesFromLibrary(
  library: LibraryTrack[],
  excludeUri: string | null,
  count: number,
): SnapshotTrack[] {
  const pool = library.filter((t) => t.uri !== excludeUri);
  if (pool.length === 0) return [];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a && b) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  return shuffled
    .slice(0, Math.min(count, shuffled.length))
    .map(libraryToSnapshotTrack);
}

function currentMoodQuestion(): MoodQuestion | undefined {
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
      // Track-Wechsel → Pipeline durchspülen.
      const library = await getLibrary();
      state.candidates = pickCandidatesFromLibrary(
        library,
        currentUri,
        CANDIDATE_COUNT,
      );
      state.committedId = null;
      state.lastTrackUri = currentUri;
      state.tracksUntilMoodSwitch -= 1;
      if (state.tracksUntilMoodSwitch <= 0) {
        state.moodQuestionIdx += 1;
        state.moodCounts = {};
        state.tracksUntilMoodSwitch = TRACKS_PER_MOOD_QUESTION;
      }
    }
  } catch (err) {
    // Polling-Fehler nicht propagieren — Tablet bleibt am letzten Snapshot
    // hängen statt der App-Lifecycle zu killen. In Production-Mode loggen
    // wir es; für Phase 4 nur console.warn.
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

export function recordMoodPress(value: string): void {
  state.moodCounts[value] = (state.moodCounts[value] ?? 0) + 1;
  emit();
}

export function togglePlaylist(name: string): void {
  if (state.activePlaylists.has(name)) state.activePlaylists.delete(name);
  else state.activePlaylists.add(name);
  emit();
}

export function commitCandidate(trackId: string): boolean {
  const exists = state.candidates.some((c) => c.id === trackId);
  if (!exists) return false;
  state.committedId = trackId;
  emit();
  return true;
}

/**
 * Anti-Buttons (👎 / ❤️) — Phase 5 wertet die Counts aus, Phase 4 zählt nur.
 * Für die UI gibt's keinen direkten State; das Toast bleibt clientseitig.
 */
const antiCounts = { dislike: 0, love: 0 };
export function recordAntiPress(value: 'dislike' | 'love'): void {
  antiCounts[value] += 1;
  // Kein emit — beeinflusst keinen sichtbaren State in Phase 4.
}
export function getAntiCounts(): Readonly<typeof antiCounts> {
  return antiCounts;
}

export function getSnapshot(): StateSnapshot {
  return buildSnapshot();
}
