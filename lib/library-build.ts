/**
 * Library-Build: Spotify-Playlists → angereicherte Library mit Genres + BPM.
 *
 * Pure Funktionen ohne Auth-Annahmen — die Spotify-Fetch-Function wird als
 * Dependency injiziert. So nutzt sowohl das CLI (`scripts/build-library.ts`,
 * Client-Credentials) als auch der `/admin`-Endpoint (User-OAuth via
 * `lib/spotify.ts::spotifyFetch`) denselben Code.
 *
 * Zusätzlich: Job-Registry für /admin-SSE-Pattern (POST → {jobId},
 * GET …/stream pro Job). Pattern wie `lib/state.ts` — EventEmitter pro Job,
 * Job läuft auch dann weiter, wenn alle SSE-Subscriber wegfallen (Browser-Tab
 * geschlossen mid-Build ist kein Datenverlust).
 *
 * Server-Only — importiert `node:events` und ruft `loadLibrary`/`saveLibrary`.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  emptyLibrary,
  loadLibrary,
  saveLibrary,
  type Library,
  type LibraryTrack,
} from './library';
import { refreshLibrary } from './state';

// ─────────────────────────────────────────────────────────────────────────────
// Spotify-Fetch-Interface (injiziert).
// ─────────────────────────────────────────────────────────────────────────────

export type SpotifyFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

// ─────────────────────────────────────────────────────────────────────────────
// Spotify-API-Typen (intern).
// ─────────────────────────────────────────────────────────────────────────────

type RawTrack = {
  uri: string;
  name: string;
  duration_ms: number;
  is_local: boolean;
  artists: { id: string; name: string }[];
  album: {
    images: { url: string; width: number | null; height: number | null }[];
  };
};

// Spotify mischt seit 2024 Tracks + Podcast-Episodes in Playlist-Items. Der
// neue `/items`-Endpoint nennt das Container-Feld `item` (alter `/tracks` hieß
// `track`). Wir akzeptieren beides defensiv, falls Spotify irgendwo noch das
// alte Schema serviert. `type === 'track'` filtert Podcast-Episoden raus.
type PlaylistItemPayload = (RawTrack & { type?: string }) | null;
type RawPlaylistItem = {
  item?: PlaylistItemPayload;
  track?: PlaylistItemPayload;
  is_local?: boolean;
};

type RawArtist = { id: string; name: string; genres: string[] };

// ─────────────────────────────────────────────────────────────────────────────
// Playlist-ID-Parser (akzeptiert URI, offene URL oder nackte ID).
// ─────────────────────────────────────────────────────────────────────────────

export function parsePlaylistId(arg: string): string {
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(arg);
  if (uriMatch) return uriMatch[1];
  const urlMatch = /^https?:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/.exec(
    arg,
  );
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9]+$/.test(arg)) return arg;
  throw new Error(`Konnte Playlist-ID aus "${arg}" nicht extrahieren.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spotify-Reader.
// ─────────────────────────────────────────────────────────────────────────────

export class PlaylistForbiddenError extends Error {
  readonly playlistId: string;
  constructor(playlistId: string) {
    super(
      `Playlist ${playlistId}: 403 Forbidden auf /v1/playlists/{id}/items. Spotify-Dev-Mode-Restriction oder Playlist-spezifische Sperre. Überspringen, Rest des Builds läuft weiter.`,
    );
    this.name = 'PlaylistForbiddenError';
    this.playlistId = playlistId;
  }
}

export async function fetchPlaylistTracks(
  playlistId: string,
  fetchSpotify: SpotifyFetch,
): Promise<RawTrack[]> {
  const out: RawTrack[] = [];
  // Spotify hat `/tracks` durch `/items` ersetzt (Playlist-Items können jetzt
  // Track ODER Episode sein, /tracks 403't auf neuere Playlists). Wir filtern
  // selbst auf `type === 'track'`.
  let url: string | null =
    `/v1/playlists/${playlistId}/items?limit=100&offset=0`;
  while (url) {
    const res: Response = await fetchSpotify(url);
    if (res.status === 403) {
      throw new PlaylistForbiddenError(playlistId);
    }
    if (!res.ok) {
      throw new Error(
        `Playlist ${playlistId} fetch failed: ${res.status} ${await res.text()}`,
      );
    }
    const page = (await res.json()) as {
      items: RawPlaylistItem[];
      next: string | null;
    };
    for (const entry of page.items) {
      // `item` ist das neue Feld, `track` der Legacy-Name. is_local kann am
      // entry-Level oder am inner Track-Objekt sitzen.
      const t = entry.item ?? entry.track ?? null;
      if (!t || t.is_local || entry.is_local) continue;
      // type ist erst seit dem /items-Switch relevant; fehlt bei alten
      // Responses → defensiv akzeptieren wenn `type` nicht gesetzt ist.
      if (t.type && t.type !== 'track') continue;
      out.push(t);
    }
    url = page.next ? page.next.replace('https://api.spotify.com', '') : null;
  }
  return out;
}

/**
 * Holt den Anzeige-Namen einer Playlist. `/v1/playlists/{id}` (Single-Metadata)
 * funktioniert auch dann, wenn `/items` 403't (siehe CLAUDE.md Spotify-Notiz #5).
 * Throw-safe — bei jedem Fehler `null`, der Caller fällt dann auf die ID zurück.
 */
export async function fetchPlaylistName(
  playlistId: string,
  fetchSpotify: SpotifyFetch,
): Promise<string | null> {
  try {
    const res = await fetchSpotify(`/v1/playlists/${playlistId}?fields=name`);
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string | null };
    const name = data.name?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export class ArtistsLookupForbiddenError extends Error {
  constructor() {
    super(
      'Artists-Lookup-API (/v1/artists) gibt 403. Spotify-Dev-Mode-Restriction für non-production-Apps — Build läuft mit leeren Genres weiter.',
    );
    this.name = 'ArtistsLookupForbiddenError';
  }
}

export async function fetchArtistsBulk(
  ids: string[],
  fetchSpotify: SpotifyFetch,
): Promise<Map<string, RawArtist>> {
  const map = new Map<string, RawArtist>();
  if (ids.length === 0) return map;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetchSpotify(`/v1/artists?ids=${chunk.join(',')}`);
    if (res.status === 403) {
      // Spotify hat das Bulk-Artist-Endpoint für Dev-Mode-Apps gesperrt.
      // Nicht hier den ganzen Build crashen — Caller (Orchestrator) fängt das
      // und macht ohne Genres weiter.
      throw new ArtistsLookupForbiddenError();
    }
    if (!res.ok) {
      throw new Error(
        `Artists-Lookup failed: ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { artists: (RawArtist | null)[] };
    for (const a of data.artists) {
      if (a) map.set(a.id, a);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// BPM-Lookup (GetSongBPM, externer Service).
// ─────────────────────────────────────────────────────────────────────────────

type BpmFetchResult = {
  bpm: number | null;
  /** Letzter HTTP-Status (für Logging). 0 = Netzfehler. */
  status: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchBpmOnce(
  title: string,
  artist: string,
  apiKey: string,
): Promise<BpmFetchResult> {
  const lookup = `song:${title.replace(/[()[\]]/g, '').trim()} artist:${artist
    .replace(/[()[\]]/g, '')
    .trim()}`;
  const url = `https://api.getsongbpm.com/search/?api_key=${encodeURIComponent(
    apiKey,
  )}&type=both&lookup=${encodeURIComponent(lookup)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { bpm: null, status: res.status };
    const data = (await res.json()) as {
      search:
        | {
            song_title: string;
            artist: { name: string };
            tempo?: string | number;
          }[]
        | { error: string };
    };
    if (!Array.isArray(data.search)) return { bpm: null, status: 200 };
    const tempo = data.search[0]?.tempo;
    if (tempo == null) return { bpm: null, status: 200 };
    const n = Number(tempo);
    return {
      bpm:
        Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n) : null,
      status: 200,
    };
  } catch {
    return { bpm: null, status: 0 };
  }
}

/**
 * BPM-Lookup mit Backoff bei 429 (Rate-Limit) und 5xx (Cloudflare-Schutz
 * antwortet bei Burst-Traffic mit 503/HTML statt 429). Throw-safe — Caller
 * bekommt immer ein `BpmFetchResult`, niemals einen Throw. Falls auch der
 * Retry fehlschlägt: `bpm: null` mit dem letzten Status.
 */
export async function fetchBpmResilient(
  title: string,
  artist: string,
  apiKey: string,
): Promise<BpmFetchResult> {
  let r = await fetchBpmOnce(title, artist, apiKey);
  if (r.status === 429 || r.status >= 500) {
    await sleep(2000);
    r = await fetchBpmOnce(title, artist, apiKey);
  }
  if (r.status === 429 || r.status >= 500) {
    await sleep(4000);
    r = await fetchBpmOnce(title, artist, apiKey);
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency-Helper. JS-Single-Thread: `next++` ist atomar zwischen awaits.
// ─────────────────────────────────────────────────────────────────────────────

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build-Orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

export type BuildProgressEvent =
  | { kind: 'phase'; phase: 'playlists' | 'artists' | 'tracks'; message: string }
  | {
      kind: 'progress';
      currentIndex: number;
      totalTracks: number;
      bpmHits: number;
      bpmMisses: number;
    }
  | { kind: 'track'; track: LibraryTrack }
  | { kind: 'warning'; playlistId?: string; message: string }
  | {
      kind: 'done';
      /** Library-Total nach dem Build (existierende + neu hinzugefügte). */
      trackCount: number;
      /** Wie viele Tracks der Build neu in den Bestand gepackt hat. */
      addedCount: number;
      /** Tracks aus den Playlists, die schon in der Library waren (skipped, nicht neu gefetcht). */
      alreadyPresentCount: number;
      bpmHits: number;
      skippedPlaylists: string[];
    }
  | { kind: 'error'; message: string };

export type BuildOptions = {
  playlistIds: string[];
  fetchSpotify: SpotifyFetch;
  bpmKey: string | null;
  existing: Library;
  onProgress?: (e: BuildProgressEvent) => void;
};

/** Default-Concurrency für BPM-Lookups + Inter-Sleep pro Worker. */
const BPM_CONCURRENCY = 2;
const BPM_INTER_SLEEP_MS = 500;

export async function buildLibraryFromPlaylists(
  opts: BuildOptions,
): Promise<Library> {
  const { playlistIds, fetchSpotify, bpmKey, existing, onProgress } = opts;
  const emit = onProgress ?? (() => {});

  // Build ist seit Phase 4b additiv: bestehende Tracks bleiben in jedem Fall
  // erhalten, nur unbekannte URIs aus den gewählten Playlists werden gefetcht
  // + angehängt. Schützt vor Datenverlust durch Fehlbedienung (gefolgte
  // Playlists → 403 → früher: leere Library; jetzt: Bestand unverändert).
  // Wer wirklich neu anfangen will, benutzt im Editor "Alle entfernen".
  const existingByUri = new Set<string>(existing.tracks.map((t) => t.uri));

  // Phase 1: Playlists laden + dedup gegen Playlist-Overlap und gegen Bestand.
  emit({
    kind: 'phase',
    phase: 'playlists',
    message: `Lade ${playlistIds.length} Playlist(s)...`,
  });
  const seenUris = new Set<string>();
  const newRawTracks: RawTrack[] = [];
  let alreadyPresentCount = 0;
  const skippedPlaylists: string[] = [];
  // uri → Set der Quell-Playlist-Namen. Wird VOR dem Dedup gefüllt, damit ein
  // Track, der in mehreren importierten Playlists vorkommt, alle Namen sammelt
  // (auch wenn er nur einmal gefetcht/angehängt wird).
  const trackPlaylists = new Map<string, Set<string>>();
  for (const pid of playlistIds) {
    try {
      // Playlist-Name als Label; bei 403/Fehler fällt fetchPlaylistName auf
      // null zurück → wir nehmen die ID als (hässlicheren) Fallback-Namen.
      const playlistName = (await fetchPlaylistName(pid, fetchSpotify)) ?? pid;
      const items = await fetchPlaylistTracks(pid, fetchSpotify);
      for (const t of items) {
        let names = trackPlaylists.get(t.uri);
        if (!names) {
          names = new Set<string>();
          trackPlaylists.set(t.uri, names);
        }
        names.add(playlistName);

        if (seenUris.has(t.uri)) continue;
        seenUris.add(t.uri);
        if (existingByUri.has(t.uri)) {
          alreadyPresentCount++;
          continue;
        }
        newRawTracks.push(t);
      }
    } catch (err) {
      if (err instanceof PlaylistForbiddenError) {
        // Spotify-kuratierte/algorithmische Playlists sind seit Nov. 2024 für
        // Third-Party-Apps gesperrt — den Build deswegen nicht abreißen, nur
        // warnen und weiter zu nächsten Playlists.
        skippedPlaylists.push(pid);
        emit({
          kind: 'warning',
          playlistId: pid,
          message: `Playlist ${pid} übersprungen (Spotify-Schutz, 403).`,
        });
        continue;
      }
      throw err;
    }
  }

  // Phase 2: Artist-Genres bulk holen — nur für neue Tracks. Spotify hat im
  // Dev-Mode auch /v1/artists eingeschränkt; bei 403 fallen wir auf leere
  // Genres zurück, statt den Build abzuwürgen. Genres sind Read-only-Metadata,
  // DJ-Brain kann (mit etwas weniger Kontext) ohne arbeiten.
  const artistIds = Array.from(
    new Set(newRawTracks.flatMap((t) => t.artists.map((a) => a.id))),
  );
  emit({
    kind: 'phase',
    phase: 'artists',
    message: `Hole Genres für ${artistIds.length} Artists...`,
  });
  let artistMap: Map<string, RawArtist>;
  try {
    artistMap = await fetchArtistsBulk(artistIds, fetchSpotify);
  } catch (err) {
    if (err instanceof ArtistsLookupForbiddenError) {
      emit({
        kind: 'warning',
        message:
          'Spotify-Artist-API (Bulk) gibt 403 (Dev-Mode-Restriction) — Genres bleiben leer. DJ-Brain (Phase 5) hat dadurch weniger Kontext, ist aber kein Build-Blocker.',
      });
      artistMap = new Map();
    } else {
      throw err;
    }
  }

  // Phase 3: pro neuem Track → Genre + BPM. BPM-Lookups parallel mit
  // begrenzter Concurrency + Inter-Sleep, throw-safe.
  emit({
    kind: 'phase',
    phase: 'tracks',
    message: `Verarbeite ${newRawTracks.length} neue Track(s)...`,
  });

  const total = newRawTracks.length;
  let bpmHits = 0;
  let bpmMisses = 0;
  let processed = 0;

  const newTracks = await mapWithConcurrency(
    newRawTracks,
    bpmKey ? BPM_CONCURRENCY : Math.max(1, newRawTracks.length), // ohne BPM-Key: rein CPU, parallelisier alles
    async (t): Promise<LibraryTrack> => {
      const genres = Array.from(
        new Set(t.artists.flatMap((a) => artistMap.get(a.id)?.genres ?? [])),
      );

      let bpm: number | null = null;
      if (bpmKey) {
        const r = await fetchBpmResilient(t.name, t.artists[0]?.name ?? '', bpmKey);
        bpm = r.bpm;
        if (r.bpm !== null) bpmHits++;
        else bpmMisses++;
        // Sanftes Inter-Sleep pro Worker, damit wir GetSongBPM nicht stürmen.
        await sleep(BPM_INTER_SLEEP_MS);
      }

      const coverUrl = t.album.images[0]?.url ?? null;
      const track: LibraryTrack = {
        uri: t.uri,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        coverUrl,
        durationMs: t.duration_ms,
        spotifyGenres: genres,
        bpm,
        moodTags: [],
        energyLevel: null,
        camelotKey: null,
        playlists: [...(trackPlaylists.get(t.uri) ?? [])],
      };

      processed++;
      emit({ kind: 'track', track });
      emit({
        kind: 'progress',
        currentIndex: processed,
        totalTracks: total,
        bpmHits,
        bpmMisses,
      });
      return track;
    },
  );

  // Bestehende Tracks, die in einer jetzt importierten Playlist (wieder)
  // vorkamen, kriegen den Playlist-Namen nachgetragen — so wird die
  // Playlist-Zugehörigkeit auch für Tracks komplett, die schon vor diesem
  // Build in der Library waren (z. B. über eine andere Playlist reingekommen).
  let existingChanged = false;
  const mergedExisting: LibraryTrack[] = existing.tracks.map((t) => {
    const fromBuild = trackPlaylists.get(t.uri);
    if (!fromBuild || fromBuild.size === 0) return t;
    const merged = Array.from(new Set([...t.playlists, ...fromBuild]));
    if (merged.length === t.playlists.length) return t;
    existingChanged = true;
    return { ...t, playlists: merged };
  });

  // Bestand bleibt vorne in seiner Reihenfolge, neue Tracks hängen hinten dran
  // (Input-Reihenfolge der Playlists). builtAt nur dann aktualisieren, wenn
  // sich tatsächlich was geändert hat (neue Tracks ODER Playlist-Merge in den
  // Bestand) — sonst bleibt der bisherige Timestamp stehen, damit "Build mit 0
  // Änderungen" nicht aussieht wie eine frische Library.
  const tracks: LibraryTrack[] = [...mergedExisting, ...newTracks];
  const library: Library = {
    builtAt:
      newTracks.length > 0 || existingChanged
        ? new Date().toISOString()
        : existing.builtAt,
    tracks,
  };
  emit({
    kind: 'done',
    trackCount: tracks.length,
    addedCount: newTracks.length,
    alreadyPresentCount,
    bpmHits,
    skippedPlaylists,
  });
  return library;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job-Registry für /admin-SSE-Pattern.
// ─────────────────────────────────────────────────────────────────────────────

export type BuildJobStatus = 'pending' | 'running' | 'done' | 'error';

export type BuildJob = {
  id: string;
  status: BuildJobStatus;
  startedAt: number;
  finishedAt: number | null;
  playlistIds: string[];
  /** Bei `status === 'error'` gesetzt. */
  errorMessage: string | null;
  /** Bei `status === 'done'` der finale Snapshot der gespeicherten Library. */
  library: Library | null;
  /** Event-Log für späte Subscriber (Re-Attach). Kompakt halten — nur progress/track/done/error. */
  eventLog: BuildProgressEvent[];
  emitter: EventEmitter;
};

const jobs = new Map<string, BuildJob>();
let activeJobId: string | null = null;

export function isRunning(): boolean {
  if (!activeJobId) return false;
  const job = jobs.get(activeJobId);
  return !!job && job.status === 'running';
}

export function getActiveJobId(): string | null {
  return isRunning() ? activeJobId : null;
}

export function getJob(jobId: string): BuildJob | null {
  return jobs.get(jobId) ?? null;
}

/**
 * Startet einen Build-Job. Wirft, wenn schon einer läuft — Caller muss vorher
 * `isRunning()` prüfen und ggf. den existierenden Stream attachen.
 */
export function startBuildJob(opts: {
  playlistIds: string[];
  fetchSpotify: SpotifyFetch;
  bpmKey: string | null;
}): BuildJob {
  if (isRunning()) {
    throw new Error('build_in_progress');
  }

  const id = randomUUID();
  const job: BuildJob = {
    id,
    status: 'pending',
    startedAt: Date.now(),
    finishedAt: null,
    playlistIds: opts.playlistIds,
    errorMessage: null,
    library: null,
    eventLog: [],
    emitter: new EventEmitter(),
  };
  jobs.set(id, job);
  activeJobId = id;

  // Async im Hintergrund laufen lassen, damit POST sofort `{jobId}` zurückgeben kann.
  void runJob(job, opts).catch((err) => {
    // Defensiv — sollte nicht passieren, da runJob seine eigenen Fehler fängt.
    const msg = err instanceof Error ? err.message : String(err);
    finalizeError(job, msg);
  });

  return job;
}

async function runJob(
  job: BuildJob,
  opts: {
    playlistIds: string[];
    fetchSpotify: SpotifyFetch;
    bpmKey: string | null;
  },
): Promise<void> {
  job.status = 'running';
  try {
    const existing = await loadLibrary().catch(() => emptyLibrary());
    const library = await buildLibraryFromPlaylists({
      ...opts,
      existing,
      onProgress: (e) => {
        job.eventLog.push(e);
        job.emitter.emit('event', e);
      },
    });
    await saveLibrary(library);
    // Cache verwerfen + Kandidaten sofort neu mischen, damit die frisch
    // importierten Tracks ohne App-Neustart im DJ-Brain-Pool landen.
    await refreshLibrary();
    job.library = library;
    job.status = 'done';
    job.finishedAt = Date.now();
    // `done` ist schon im eventLog (vom Orchestrator emittiert), aber für späte
    // Subscriber ist `getJob().status` der primäre Wahrheits-Check.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finalizeError(job, msg);
  } finally {
    if (activeJobId === job.id) activeJobId = null;
  }
}

function finalizeError(job: BuildJob, msg: string): void {
  job.status = 'error';
  job.errorMessage = msg;
  job.finishedAt = Date.now();
  const ev: BuildProgressEvent = { kind: 'error', message: msg };
  job.eventLog.push(ev);
  job.emitter.emit('event', ev);
  if (activeJobId === job.id) activeJobId = null;
}
