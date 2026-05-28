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
  FilterNotice,
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
  startPlaybackTrack,
  type NowPlaying,
} from './spotify';
import {
  aggregateButtonLog,
  proposeNextCandidates,
  type ButtonLogEntry,
} from './dj-brain';
import { getSettings } from './settings';

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
/**
 * Wenn der Cooldown-Filter so hart greift, dass weniger als das übrig bleibt,
 * lassen wir ihn für diesen Pick fallen (nur currentUri excluden). Verhindert,
 * dass der Brain bei kleinen Libraries oder zu langem Cooldown nichts mehr
 * findet.
 */
const MIN_POOL_AFTER_COOLDOWN = 6;
/** `playedAt`-Einträge älter als das werden beim nächsten Track-Wechsel weggeräumt. */
const PLAYED_AT_GC_MS = 12 * 60 * 60 * 1000;

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
  /** Filter-Modus (Host-Setting, gespiegelt aus settings.json bei jedem Poll). */
  filterMode: 'playlists' | 'genres';
  /** Ob BPM angezeigt + vom Brain berücksichtigt wird (Host-Setting, gespiegelt). */
  bpmEnabled: boolean;
  /** URI des zuletzt gesehenen Tracks — Edge-Detect für Track-Wechsel. */
  lastTrackUri: string | null;
  /** Letzte HISTORY_MAX URIs (neueste zuletzt). */
  history: string[];
  /** URI → wall-clock-ms des letzten Play-Endes. Für den Cooldown-Filter. */
  playedAt: Record<string, number>;
  /** Wall-clock-Zeit des ersten Tracks der Session (für LLM-Energie-Curve-Hint). */
  partyStartedAt: number;
  /** Rolling Log der Button-Klicks für recency-weighted Aggregation. */
  buttonLog: ButtonLogEntry[];
  /** Letzter DJ-Brain-Status (Provider + Latenz); für Admin-Badge via SSE. */
  lastBrain: SnapshotBrainStatus | null;
  /** Filter-Hinweis fürs Tablet, wenn der Pool zu klein war (sonst null). */
  filterNotice: FilterNotice | null;
};

/**
 * Dev-HMR-Survival: Next.js dev-server reloaded dieses Modul bei jedem Fast
 * Refresh, was sonst `state` und `emitter` resettet. Bestehende SSE-Streams
 * hingen am alten Emitter → Tablet rendert stale candidates, POSTs treffen
 * fresh state → 409 not_a_candidate. Lösung: alles unter einem Symbol auf
 * globalThis stashen, damit das Singleton den Reload überlebt.
 *
 * Production (`next start`) reloaded nichts — der globalThis-Indirect kostet
 * dort nichts.
 */
type GlobalStash = {
  state: InternalState;
  emitter: EventEmitter;
  subscriberCount: number;
  pollTimer: NodeJS.Timeout | null;
  libraryCache: LibraryTrack[] | null;
  recomputeInFlight: boolean;
  recomputeQueued: boolean;
};
const GLOBAL_KEY = '__aidj_state_singleton__';
type GlobalWithStash = typeof globalThis & {
  [GLOBAL_KEY]?: GlobalStash;
};
const g = globalThis as GlobalWithStash;

if (!g[GLOBAL_KEY]) {
  const newEmitter = new EventEmitter();
  newEmitter.setMaxListeners(50);
  g[GLOBAL_KEY] = {
    state: {
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
      filterMode: 'playlists',
      bpmEnabled: true,
      lastTrackUri: null,
      history: [],
      playedAt: {},
      partyStartedAt: Date.now(),
      buttonLog: [],
      lastBrain: null,
      filterNotice: null,
    },
    emitter: newEmitter,
    subscriberCount: 0,
    pollTimer: null,
    libraryCache: null,
    recomputeInFlight: false,
    recomputeQueued: false,
  };
}

const stash = g[GLOBAL_KEY]!;
const state: InternalState = stash.state;
const emitter: EventEmitter = stash.emitter;

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
  if (stash.libraryCache) return stash.libraryCache;
  const lib = await loadLibrary();
  stash.libraryCache = lib.tracks;
  return stash.libraryCache;
}

/**
 * Wirft den In-Memory-Library-Cache weg. Low-Level-Primitive — für „sofort
 * wirksam ohne Neustart" lieber [refreshLibrary] nutzen, das zusätzlich Cache
 * neu füllt, Kandidaten neu mischt und an die Clients emittiert.
 */
export function invalidateLibraryCache(): void {
  stash.libraryCache = null;
}

/**
 * Library-Datei hat sich geändert (Editor-Save oder Playlist-Import) → Cache
 * verwerfen, frisch nachladen und die Kandidaten sofort neu mischen, damit
 * Änderungen (neue/entfernte Tracks, geänderte Tags/Energy/Key) **ohne
 * App-Neustart** wirksam werden. Danach emit(), damit Tablet/Phone/Admin den
 * neuen Stand über SSE bekommen.
 *
 * Niemals throwen: ein Fehler beim Recompute darf den auslösenden Save-/Build-
 * Request nicht killen — die Datei ist ja bereits korrekt geschrieben.
 */
export async function refreshLibrary(): Promise<void> {
  stash.libraryCache = null;
  try {
    // Cache explizit neu füllen — recomputeCandidates ruft getLibrary() nur,
    // wenn Brain-Slots zu füllen sind; computeFilterOptions() braucht den Cache
    // aber immer (sonst leere Filter-Labels nach dem Refresh).
    await getLibrary();
    await recomputeCandidates(state.lastTrackUri);
  } catch (err) {
    console.warn('[state] refreshLibrary failed:', err);
  }
  emit();
}

/**
 * Holt sich neue Kandidaten vom DJ-Brain (Phase 5). Brain entscheidet intern,
 * ob LLM oder Heuristik — beide Pfade liefern dieselbe Output-Form. Updated
 * auch ggf. die Mood-Frage (LLM kann `shouldRefreshMoodQuestion` setzen).
 *
 * Niemals throwen: bei totalen Brain-Ausfall (sollte mit dem internen
 * Fallback nie passieren) leeres Candidate-Array statt Crash.
 *
 * `count` = wieviele Slots der Brain füllen soll (Rest wird von Gast-Wünschen
 * gefüllt). `extraExcludeUris` ergänzt die History — z.B. mit den URIs der
 * Gast-Wünsche, damit der Brain keine Duplikate vorschlägt.
 */
async function pickCandidatesViaBrain(
  library: LibraryTrack[],
  currentUri: string | null,
  count: number,
  extraExcludeUris: string[] = [],
): Promise<{
  candidates: SnapshotTrack[];
  reasonings: Record<string, string>;
  filterNotice: FilterNotice | null;
}> {
  if (count <= 0) return { candidates: [], reasonings: {}, filterNotice: null };
  try {
    const history = state.history.slice(-HISTORY_MAX);
    const augmentedHistory = extraExcludeUris.length > 0
      ? [...history, ...extraExcludeUris]
      : history;

    // Cooldown anwenden: Tracks, die innerhalb des Fensters liefen, raus aus
    // dem Pool. Sicherheitsnetz: wenn der Filter zu hart greift (Mini-Library
    // oder gerade alle gespielt), für diesen Pick soft-skippen, sonst kriegt
    // der Brain einen leeren Pool und Plan-2-Lock-Window failt.
    const settings = await getSettings();
    const cooldownMs = settings.cooldownMinutes * 60_000;
    let filteredLibrary = library;
    if (cooldownMs > 0) {
      const now = Date.now();
      const blocked = new Set<string>();
      for (const [uri, ts] of Object.entries(state.playedAt)) {
        if (now - ts < cooldownMs) blocked.add(uri);
      }
      const candidate = library.filter((t) => !blocked.has(t.uri));
      if (candidate.length >= MIN_POOL_AFTER_COOLDOWN) {
        filteredLibrary = candidate;
      } else {
        console.warn(
          `[state] cooldown filter would leave only ${candidate.length} tracks — skipping cooldown for this pick`,
        );
      }
    }

    // Aktive Filter (Playlist- ODER Genre-Namen, je nach filterMode) anwenden.
    // Statt den Filter bei zu kleinem Pool lautlos zu droppen (alt), halten wir
    // ihn strikt: passende Tracks werden BEVORZUGT (force-include), und nur wenn
    // es zu wenige gibt, füllen wir den Rest mit Off-Filter-Tracks auf, damit das
    // Lock-Window nie ohne Kandidaten dasteht. Das Auffüllen wird über
    // `filterNotice` ans Tablet gemeldet — kein stiller Genre-Mix mehr.
    let forcedTracks: LibraryTrack[] = [];
    let filterNotice: FilterNotice | null = null;
    let brainPool = filteredLibrary;
    if (state.activePlaylists.size > 0) {
      const active = state.activePlaylists;
      const inGenreMode = state.filterMode === 'genres';
      const matching = filteredLibrary.filter((t) => {
        const labels = inGenreMode ? t.spotifyGenres : t.playlists;
        return labels.some((v) => active.has(v));
      });
      const label = [...active].join(', ');
      if (matching.length >= count) {
        // Genug Treffer → strikt: Brain pickt ausschließlich aus dem Filter-Pool.
        brainPool = matching;
      } else {
        // Zu wenige (inkl. 0): vorhandene Treffer garantiert reinnehmen (außer
        // dem laufenden Track + History, sonst Dauer-Wiederholung), Rest aus dem
        // übrigen Pool auffüllen. Notice meldet, wie viele wirklich passten.
        const exclude = new Set<string>([
          ...(currentUri ? [currentUri] : []),
          ...augmentedHistory,
        ]);
        forcedTracks = matching
          .filter((t) => !exclude.has(t.uri))
          .slice(0, count);
        const forcedUris = new Set(forcedTracks.map((t) => t.uri));
        brainPool = filteredLibrary.filter((t) => !forcedUris.has(t.uri));
        filterNotice = { label, matched: matching.length, requested: count };
      }
    }

    const forcedCandidates: SnapshotTrack[] = forcedTracks.map((t) => ({
      ...libraryToSnapshotTrack(t),
      source: 'brain' as const,
    }));
    const reasonings: Record<string, string> = {};
    for (const t of forcedTracks) {
      reasonings[t.uri] = `filter-match: ${[...state.activePlaylists].join(', ')}`;
    }

    const remaining = count - forcedCandidates.length;
    // remaining <= 0 kann im Force-Pfad praktisch nicht auftreten (matching <
    // count ⇒ forced < count), aber defensiv: dann den Brain-Call sparen.
    if (remaining <= 0) {
      return {
        candidates: forcedCandidates.slice(0, count),
        reasonings,
        filterNotice,
      };
    }

    // BPM-Berücksichtigung aus (Host-Setting): BPM aus dem Pool nullen, dann
    // ignorieren sowohl Heuristik (BPM-Distanz-Score fällt weg) als auch LLM
    // (sieht bpm:null) das Tempo komplett.
    const brainLibrary = state.bpmEnabled
      ? brainPool
      : brainPool.map((t) => (t.bpm === null ? t : { ...t, bpm: null }));

    const result = await proposeNextCandidates(
      {
        library: brainLibrary,
        currentTrackUri: currentUri,
        history: [...augmentedHistory, ...forcedTracks.map((t) => t.uri)],
        activePlaylists: [...state.activePlaylists],
        currentMoodQuestion:
          state.customMoodQuestion ?? currentMoodQuestion() ?? null,
        moodCounts: state.moodCounts,
        aggregated: aggregateButtonLog(state.buttonLog, Date.now()),
        now: Date.now(),
        partyStartedAt: state.partyStartedAt,
      },
      {
        count: remaining,
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

    const candidates: SnapshotTrack[] = [...forcedCandidates];
    for (const c of result.candidates.slice(0, remaining)) {
      const t = library.find((x) => x.uri === c.trackUri);
      if (!t) continue;
      const snapshot: SnapshotTrack = {
        ...libraryToSnapshotTrack(t),
        source: 'brain',
      };
      candidates.push(snapshot);
      reasonings[snapshot.id] = c.reasoning;
    }
    return { candidates: candidates.slice(0, count), reasonings, filterNotice };
  } catch (err) {
    console.warn('[state] dj-brain crashed unexpectedly:', err);
    return { candidates: [], reasonings: {}, filterNotice: null };
  }
}

/**
 * Konvertiert einen Gast-Queue-Eintrag in einen Snapshot-Track für die
 * Kandidaten-Liste. URI + Title/Artist/Cover kommen aus dem submitten gesetzten
 * `trackMeta`; BPM und Genre versuchen wir aus der Library zu ziehen, falls
 * der Track dort kuratiert ist — sonst defaulten wir.
 */
function guestEntryToCandidate(entry: GuestEntry): SnapshotTrack {
  const enriched = stash.libraryCache?.find((t) => t.uri === entry.trackUri);
  return {
    id: entry.trackUri,
    title: entry.trackMeta.title,
    artist: entry.trackMeta.artist,
    coverUrl:
      entry.trackMeta.coverUrl ||
      enriched?.coverUrl ||
      'https://via.placeholder.com/600x600.png?text=No+Cover',
    bpm: enriched?.bpm ?? DEFAULT_BPM,
    durationMs: entry.trackMeta.durationMs,
    genre: enriched?.spotifyGenres[0] ?? '',
    source: 'guest',
    submissionId: entry.submissionId,
    guestName: entry.guestName,
  };
}

/**
 * Re-build der `state.candidates` aus zwei Quellen:
 *   - Pending Gast-Wünsche, FIFO, von vorne aufgefüllt (max CANDIDATE_COUNT).
 *   - Rest mit Brain-Picks, History inkl. Gast-URIs erweitert.
 *
 * `committedId` wird neu gesetzt:
 *   - Wenn der vorherige committed-Track noch in den neuen Candidates ist,
 *     behalten (DJ-Tap überlebt einen Wunsch-Submit).
 *   - Sonst: ältester Gast-Wunsch oder Top-Brain-Pick = default-vor-selektiert.
 *
 * Coalescing: parallele Aufrufe (Track-Wechsel + Submit gleichzeitig) werden
 * via `recomputeInFlight`/`recomputeQueued` serialisiert; während ein Run
 * läuft, vermerken weitere Aufrufe nur einen Re-Run-Wunsch.
 */
async function recomputeCandidates(currentUri: string | null): Promise<void> {
  if (stash.recomputeInFlight) {
    stash.recomputeQueued = true;
    return;
  }
  stash.recomputeInFlight = true;
  try {
    do {
      stash.recomputeQueued = false;
      const guestSlots = listActiveGuests()
        .filter((e) => e.status === 'pending')
        .slice(0, CANDIDATE_COUNT);
      const guestCandidates = guestSlots.map(guestEntryToCandidate);

      const llmCount = Math.max(0, CANDIDATE_COUNT - guestCandidates.length);
      let brainCandidates: SnapshotTrack[] = [];
      let brainReasonings: Record<string, string> = {};
      if (llmCount > 0) {
        const library = await getLibrary();
        const picked = await pickCandidatesViaBrain(
          library,
          currentUri,
          llmCount,
          guestSlots.map((g) => g.trackUri),
        );
        brainCandidates = picked.candidates;
        brainReasonings = picked.reasonings;
        state.filterNotice = picked.filterNotice;
      } else {
        // Alle Slots von Gast-Wünschen belegt → Filter spielt keine Rolle.
        state.filterNotice = null;
      }
      // Bei llmCount === 0: state.lastBrain bleibt stehen (alter Stand der
      // letzten Brain-Antwort), Reasonings für Brain-Slots bleiben leer.

      const newCandidates: SnapshotTrack[] = [
        ...guestCandidates,
        ...brainCandidates,
      ].slice(0, CANDIDATE_COUNT);
      state.candidates = newCandidates;
      // Reasonings nur für Brain-Slots — Gast-Slots brauchen keine.
      state.candidateReasonings = brainReasonings;

      // committedId-Preserve-Regel: DJ-Tap überlebt einen Wunsch-Submit, wenn
      // der getippte Track noch in den neuen Candidates ist. Sonst Default.
      const prevCommitted = state.committedId;
      if (
        prevCommitted &&
        newCandidates.some((c) => c.id === prevCommitted)
      ) {
        // behalten
      } else {
        state.committedId =
          guestCandidates[0]?.id ?? newCandidates[0]?.id ?? null;
      }
    } while (stash.recomputeQueued);
  } finally {
    stash.recomputeInFlight = false;
  }
}

function currentMoodQuestion(): MoodQuestion | undefined {
  if (state.customMoodQuestion) return state.customMoodQuestion;
  if (MOCK_MOOD_QUESTIONS.length === 0) return undefined;
  return MOCK_MOOD_QUESTIONS[state.moodQuestionIdx % MOCK_MOOD_QUESTIONS.length];
}

/**
 * Leitet die Filter-Labels für den Tablet-/Phone-Button aus der Library ab:
 * im Playlist-Modus die Vereinigung aller `playlists`, im Genre-Modus die der
 * `spotifyGenres`. Sortiert + dedupliziert. Liest den Library-Cache synchron —
 * solange der noch nicht gefüllt ist (vor dem ersten Track-Wechsel), leer.
 */
function computeFilterOptions(): string[] {
  const lib = stash.libraryCache;
  if (!lib) return [];
  const inGenreMode = state.filterMode === 'genres';
  const set = new Set<string>();
  for (const t of lib) {
    for (const label of inGenreMode ? t.spotifyGenres : t.playlists) {
      set.add(label);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function buildSnapshot(): StateSnapshot {
  const np = state.nowPlaying;
  const mq = currentMoodQuestion();
  let track: SnapshotTrack | null = null;
  if (np) {
    const enriched = stash.libraryCache?.find((t) => t.uri === np.track.uri);
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
    filterMode: state.filterMode,
    filterOptions: computeFilterOptions(),
    filterNotice: state.filterNotice,
    bpmEnabled: state.bpmEnabled,
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
  // Filter-Modus aus den Host-Settings spiegeln (in-memory-cached → billig) und
  // den Library-Cache warm halten, damit `filterOptions` im Snapshot verfügbar
  // ist, auch bevor der erste Track-Wechsel den Cache via Brain-Pick füllt.
  try {
    const settings = await getSettings();
    state.filterMode = settings.antiFilterMode;
    state.bpmEnabled = settings.bpmEnabled;
    await getLibrary();
  } catch {
    // Settings/Library nicht ladbar → Defaults behalten, nicht crashen.
  }
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
        // Cooldown-Timestamp: jetzt ist der Track "fertig gespielt".
        state.playedAt[state.lastTrackUri] = Date.now();
        // GC bei Gelegenheit — verhindert unbounded growth bei stundenlangen Sessions.
        const cutoff = Date.now() - PLAYED_AT_GC_MS;
        for (const uri of Object.keys(state.playedAt)) {
          if (state.playedAt[uri]! < cutoff) delete state.playedAt[uri];
        }
      }
      // Plan2: Wenn der jetzt laufende Track ein pending Gast-Wunsch ist
      // (Lock-Window hat ihn gerade gepuscht), direkt als `done` markieren —
      // der Wunsch ist erfüllt und sein Slot wird im Recompute frei.
      if (currentUri) {
        guestMarkPlaying(currentUri);
        guestMarkDone(currentUri);
      }

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

      // Kandidaten neu mischen — Gast-Wünsche zuerst, Brain für den Rest.
      await recomputeCandidates(currentUri);
    }

    // ── Lock-Window: ~10s vor Track-Ende den committedId-Track in Spotify
    // queueen. Plan2: committedId ist nach recomputeCandidates non-null sobald
    // irgendein Candidate da ist (Gast-Wunsch oder Top-Brain-Pick), kein
    // Fallback mehr nötig.
    if (
      np &&
      currentUri &&
      state.lockedTrackUri === null &&
      np.track.durationMs - np.progressMs <= LOCK_WINDOW_MS &&
      np.track.durationMs - np.progressMs > 0
    ) {
      const pickUri = state.committedId;
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
  if (stash.pollTimer) return;
  // Erster Poll sofort, damit der erste Subscriber nicht 5 s leeren State sieht.
  void poll();
  stash.pollTimer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (!stash.pollTimer) return;
  clearInterval(stash.pollTimer);
  stash.pollTimer = null;
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
  stash.subscriberCount += 1;
  if (stash.subscriberCount === 1) {
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
      stash.subscriberCount = Math.max(0, stash.subscriberCount - 1);
      if (stash.subscriberCount === 0) {
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
    // Plan2: Gast-Slots überleben den Re-Rank, nur Brain-Slots werden neu
    // gewürfelt. recomputeCandidates trifft die committedId-Preserve-Logik
    // selbst (DJ-Tap auf Brain-Karte überlebt nicht, Tap auf Gast-Karte schon
    // weil die Karte noch da ist).
    await recomputeCandidates(state.lastTrackUri);
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
  // Sofort emitten, damit der Filter-Chip im UI direkt umschaltet, …
  emit();
  // … dann den Pick auf der neuen Filter-Basis neu mischen (fire-and-forget,
  // emittet selbst nochmal wenn die neuen Kandidaten da sind). Der nächste
  // Track-Wechsel würde den Filter sonst erst Minuten später anwenden.
  void reRankAsync('filter-toggle');
}

/**
 * Wendet einen Filter-Modus-Wechsel (Host-Setting) an: spiegelt den Modus in
 * den State, leert die aktiven Filter (Playlist- vs Genre-Labels sind
 * verschiedene Wertebereiche, alte Auswahl wäre sinnlos) und pusht ein
 * SSE-Update, damit Tablet/Phone sofort die neue Label-Liste zeigen. Wird vom
 * Settings-PUT-Endpoint aufgerufen.
 */
export function applyFilterMode(mode: 'playlists' | 'genres'): void {
  const changed = state.filterMode !== mode;
  state.filterMode = mode;
  if (changed) state.activePlaylists.clear();
  emit();
  // Modus-Wechsel leert die aktiven Filter → der Pool ist wieder die ganze
  // Library. Trotzdem neu mischen, damit ein evtl. aktiver Filter sofort
  // wegfällt statt erst beim nächsten Track-Wechsel.
  if (changed) void reRankAsync('filter-mode-switch');
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
  | { ok: false; error: 'queue_full' };

/**
 * Plan2: Submit pusht NICHT mehr direkt zur Spotify-Queue. Stattdessen landet
 * der Track im internen `state.candidates`-Pool (über `recomputeCandidates`).
 * Das Lock-Window ~10 s vor Track-Ende oder ein User-Skip pusht den
 * vor-selektierten committedId-Track an Spotify.
 *
 * Reihenfolge:
 *   1. `guestEnqueue` (mutex, idempotent, quota+max-pending).
 *   2. `recomputeCandidates(lastTrackUri)` — die neue Wunsch-Karte verdrängt
 *      einen LLM-Slot ohne auf den Track-Wechsel zu warten.
 *   3. `emit()` für sofortige UI-Aktualisierung.
 *
 * Fehler-Typen ohne Spotify reduzieren sich auf `quota_exceeded` + `queue_full`.
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
  // Bei deduped wie auch bei frischem Enqueue: Candidates neu mischen, damit
  // das Tablet die Karte direkt sieht.
  await recomputeCandidates(state.lastTrackUri);
  emit();
  return {
    ok: true,
    entry: queued.entry,
    position: queued.position,
    deduped: queued.deduped,
  };
}

/**
 * Plan2: Notfall-Lösch-Geste vom Tablet (Long-Press auf Wunsch-Karte).
 * Entfernt den Entry komplett aus der Gast-Queue, sodass der Gast direkt neu
 * submitten kann. Danach Candidates neu mischen — der frei gewordene Slot
 * wird ggf. von einem LLM-Pick gefüllt.
 */
export async function removeGuestWish(submissionId: string): Promise<void> {
  await guestRollback(submissionId);
  await recomputeCandidates(state.lastTrackUri);
  emit();
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
  void reRankAsync(value);
  emit();
}
export function getAntiCounts(): Readonly<typeof antiCounts> {
  return antiCounts;
}

/**
 * Skip-Track. Plan2: Statt `skipToNext` (das spielt aus Spotifys eigener
 * Queue irgendwas Altes — Album-Auto-Advance, frühere Lock-Window-Pushes etc.)
 * starten wir explizit den committedId-Track via `startPlaybackTrack`. So
 * landen wir verbindlich beim vor-selektierten Pick.
 *
 * Fallback auf `skipToNext` nur wenn noch gar kein Candidate da ist
 * (Edge-Case erste Session, Brain noch nicht durch).
 *
 * `state.lockedTrackUri = pickUri` verhindert, dass das nachfolgende
 * Lock-Window denselben Track nochmal an die Queue hängt.
 */
export type SkipResult =
  | { ok: true }
  | { ok: false; error: 'not_connected' | 'no_active_device' | 'spotify_error'; message: string };

export async function skipCurrentTrack(): Promise<SkipResult> {
  const pickUri = state.committedId;
  try {
    if (pickUri) {
      await startPlaybackTrack(pickUri, state.activeDeviceId ?? undefined);
      state.lockedTrackUri = pickUri;
    } else {
      await skipToNext(state.activeDeviceId ?? undefined);
    }
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
