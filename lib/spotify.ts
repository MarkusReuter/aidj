/**
 * Spotify-Wrapper (Server-Only).
 *
 * Authorization Code Flow (kein PKCE): die App läuft als Confidential Client
 * auf dem Mac mit Zugriff auf den Client Secret — PKCE wäre nur für Public
 * Clients (SPA/Mobile) nötig.
 *
 * Token-Persistenz: `~/.aidj-app/token.json`, mit `chmod 0600` auf POSIX
 * (Windows ignoriert den Modus, Node loggt nicht). Atomic-Write via tmp+rename,
 * gleiches Muster wie `lib/library.ts`.
 *
 * Auto-Refresh: `getAccessToken()` refresht proaktiv, wenn weniger als 60 s
 * Restlaufzeit. Zusätzlich wrappt `spotifyFetch()` jeden Call mit einem 401-Retry:
 * Spotify-Tokens können auch früher invalidiert werden (Passwort-Change etc.),
 * dann zwingt ein 401 einen Force-Refresh und einen einzelnen Retry.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const TOKEN_PATH = join(homedir(), '.aidj-app', 'token.json');

const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  // Phase 4b: Library-Build aus eigenen Playlists. `playlist-read-collaborative`
  // ist nicht nötig — `/v1/me/playlists` listet auch ohne ihn alle Collab-Playlists.
  'playlist-read-private',
];

export type SpotifyTokenFile = {
  accessToken: string;
  refreshToken: string;
  // Absolute Unix-ms — wann der Access-Token ungültig wird.
  expiresAt: number;
  scope: string;
  obtainedAt: number;
};

type SpotifyAuthResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

export class SpotifyNotConnectedError extends Error {
  constructor() {
    super(
      'Spotify ist nicht verbunden — öffne /api/spotify/auth, um den OAuth-Flow zu starten.',
    );
    this.name = 'SpotifyNotConnectedError';
  }
}

export class SpotifyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyConfigError';
  }
}

/**
 * Wird geworfen, wenn der gespeicherte Token einen geforderten Scope nicht hat.
 * API-Routen mappen das auf HTTP 401 `{error: 'reauth_required'}`, die UI zeigt
 * dann einen Banner "Spotify neu verbinden" → öffnet /api/spotify/auth.
 */
export class SpotifyScopeError extends Error {
  readonly missingScope: string;
  constructor(missingScope: string) {
    super(
      `Spotify-Scope "${missingScope}" fehlt — Re-Auth nötig via /api/spotify/auth.`,
    );
    this.name = 'SpotifyScopeError';
    this.missingScope = missingScope;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new SpotifyConfigError(
      `${name} fehlt in .env.local. Spotify-Dashboard: https://developer.spotify.com/dashboard`,
    );
  }
  return v;
}

function getClientCreds(): { id: string; secret: string; redirectUri: string } {
  return {
    id: requireEnv('SPOTIFY_CLIENT_ID'),
    secret: requireEnv('SPOTIFY_CLIENT_SECRET'),
    redirectUri: requireEnv('SPOTIFY_REDIRECT_URI'),
  };
}

/**
 * Baut die Spotify-Authorize-URL für den OAuth-Start. `state` muss vom Caller
 * generiert + via HttpOnly-Cookie an den Callback weitergereicht werden (CSRF).
 */
export function buildAuthorizeUrl(state: string): string {
  const { id, redirectUri } = getClientCreds();
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', id);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // show_dialog=false → User wird nur beim ersten Mal gefragt; bei Re-Auth
  // mit demselben Account kommt direkt der Callback.
  url.searchParams.set('show_dialog', 'false');
  return url.toString();
}

/**
 * Tauscht den Authorization-Code gegen Access+Refresh-Token und persistiert
 * beides auf Disk.
 */
export async function exchangeCodeForToken(code: string): Promise<SpotifyTokenFile> {
  const { id, secret, redirectUri } = getClientCreds();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Spotify-Token-Exchange fehlgeschlagen: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as SpotifyAuthResponse;
  if (!data.refresh_token) {
    throw new Error(
      'Spotify-Token-Exchange lieferte keinen refresh_token — vermutlich Re-Auth, aber ohne gespeicherten alten Token nicht nutzbar.',
    );
  }
  const tokenFile: SpotifyTokenFile = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    obtainedAt: Date.now(),
  };
  await saveToken(tokenFile);
  return tokenFile;
}

/**
 * Refresht den Access-Token mit dem bestehenden Refresh-Token. Spotify schickt
 * gelegentlich auch einen neuen Refresh-Token mit — den dann übernehmen.
 */
async function refreshAccessToken(current: SpotifyTokenFile): Promise<SpotifyTokenFile> {
  const { id, secret } = getClientCreds();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Spotify-Token-Refresh fehlgeschlagen: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as SpotifyAuthResponse;
  const updated: SpotifyTokenFile = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope || current.scope,
    obtainedAt: Date.now(),
  };
  await saveToken(updated);
  return updated;
}

async function loadToken(): Promise<SpotifyTokenFile | null> {
  try {
    const raw = await readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(raw) as SpotifyTokenFile;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
}

async function saveToken(token: SpotifyTokenFile): Promise<void> {
  const dir = dirname(TOKEN_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = TOKEN_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(token, null, 2) + '\n', 'utf8');
  await rename(tmp, TOKEN_PATH);
  // Windows ignoriert chmod still — nur POSIX setzt 0600.
  try {
    await chmod(TOKEN_PATH, 0o600);
  } catch {
    // ignore — auf Windows nicht relevant.
  }
}

/**
 * Gibt einen gültigen Access-Token zurück. Refresht proaktiv, wenn weniger als
 * 60 s Restlaufzeit (= geringes Risiko, mitten in einem Request abzulaufen).
 * Wirft `SpotifyNotConnectedError`, wenn noch kein OAuth-Flow durchlaufen wurde.
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  let token = await loadToken();
  if (!token) throw new SpotifyNotConnectedError();
  const needsRefresh = forceRefresh || token.expiresAt - Date.now() < 60_000;
  if (needsRefresh) {
    token = await refreshAccessToken(token);
  }
  return token.accessToken;
}

export async function isConnected(): Promise<boolean> {
  return (await loadToken()) !== null;
}

/**
 * Prüft, ob der gespeicherte Token einen bestimmten Scope hat. Spotify gibt
 * Scopes als space-separated String zurück (`scope: "a b c"`); wir tokenizen
 * und matchen exakt. Wirft `SpotifyNotConnectedError`, wenn kein Token da ist.
 */
export async function hasScope(name: string): Promise<boolean> {
  const token = await loadToken();
  if (!token) throw new SpotifyNotConnectedError();
  return token.scope.split(/\s+/).filter(Boolean).includes(name);
}

/**
 * Bequemer Wrapper: `await requireScope('playlist-read-private')` an den
 * Anfang eines Endpoints stellen → Routen-Code muss nur `SpotifyScopeError`
 * fangen, nicht jede Scope-Prüfung explizit ausformulieren.
 */
export async function requireScope(name: string): Promise<void> {
  if (!(await hasScope(name))) {
    throw new SpotifyScopeError(name);
  }
}

/**
 * Wrapper um `fetch()` zur Spotify-Web-API. Setzt den Bearer-Header und
 * versucht bei 401 einen einmaligen Force-Refresh + Retry. Bei allen anderen
 * Fehlern wird die Response unverändert zurückgegeben — Caller entscheidet.
 *
 * Exportiert für Wiederverwendung in `lib/library-build.ts` (Phase 4b) — die
 * `fetchSpotify`-Funktion wird dort als Dependency injiziert.
 */
export async function spotifyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://api.spotify.com${path}`;
  let token = await getAccessToken();
  const doFetch = () =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await doFetch();
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await doFetch();
  }
  return res;
}

export type SpotifyDevice = {
  id: string;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
  supports_volume: boolean;
};

export async function getDevices(): Promise<SpotifyDevice[]> {
  const res = await spotifyFetch('/v1/me/player/devices');
  if (!res.ok) {
    throw new Error(`getDevices: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { devices: SpotifyDevice[] };
  return data.devices;
}

/**
 * Transferiert die aktive Playback-Session auf das angegebene Device.
 * `play: false` heißt: laufenden Pause-Zustand beibehalten. Spotify queued
 * sonst automatisch weiter.
 */
export async function transferPlayback(deviceId: string, play = false): Promise<void> {
  const res = await spotifyFetch('/v1/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`transferPlayback: ${res.status} ${await res.text()}`);
  }
}

export type NowPlaying = {
  isPlaying: boolean;
  progressMs: number;
  track: {
    uri: string;
    name: string;
    artists: string[];
    durationMs: number;
    coverUrl: string | null;
  };
} | null;

/**
 * Liest aktuelle Wiedergabe. Spotify liefert 204 No Content, wenn nichts läuft
 * (kein Device aktiv oder Playback gestoppt) — wir mappen das auf `null`.
 */
export async function getCurrentTrack(): Promise<NowPlaying> {
  const res = await spotifyFetch('/v1/me/player');
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error(`getCurrentTrack: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    is_playing: boolean;
    progress_ms: number | null;
    item: {
      uri: string;
      name: string;
      duration_ms: number;
      artists: { name: string }[];
      album: { images: { url: string; width: number; height: number }[] };
    } | null;
  };
  if (!data.item) return null;
  const cover =
    data.item.album.images.find((i) => i.width >= 300) ??
    data.item.album.images[0] ??
    null;
  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms ?? 0,
    track: {
      uri: data.item.uri,
      name: data.item.name,
      artists: data.item.artists.map((a) => a.name),
      durationMs: data.item.duration_ms,
      coverUrl: cover?.url ?? null,
    },
  };
}

/**
 * Hängt einen Track ans Ende der Spotify-Queue. Spotify gibt 204 zurück.
 * 404 kommt, wenn kein aktives Device existiert — surface das als spezifischer
 * Fehler, damit der Caller "Device wählen" anzeigen kann.
 */
export async function addToQueue(uri: string, deviceId?: string): Promise<void> {
  const qs = new URLSearchParams({ uri });
  if (deviceId) qs.set('device_id', deviceId);
  const res = await spotifyFetch(`/v1/me/player/queue?${qs}`, { method: 'POST' });
  if (res.status === 204) return;
  if (res.status === 404) {
    throw new Error(
      'Kein aktives Spotify-Device. Öffne die Spotify-App, starte einen Track oder wähle ein Device über /api/spotify/select-device.',
    );
  }
  throw new Error(`addToQueue: ${res.status} ${await res.text()}`);
}

export async function skipToNext(deviceId?: string): Promise<void> {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const res = await spotifyFetch(`/v1/me/player/next${qs}`, { method: 'POST' });
  if (res.status === 204) return;
  if (res.status === 404) {
    throw new Error('Kein aktives Spotify-Device für skip.');
  }
  throw new Error(`skipToNext: ${res.status} ${await res.text()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4b: Eigene User-Identity + Playlists (für /admin Library-Build).
// ─────────────────────────────────────────────────────────────────────────────

export type SpotifyMe = {
  id: string;
  displayName: string | null;
};

let cachedMe: SpotifyMe | null = null;

/**
 * Liefert die eigene Spotify-User-Identity. Wird pro Prozess gecached — die ID
 * ändert sich nicht über die Lifetime des Tokens. Cache wird bei Re-Auth nicht
 * automatisch invalidiert; falls jemand mit anderem Account neu verbindet,
 * App neustarten (oder explizit `clearMeCache()` aufrufen).
 */
export async function getMe(): Promise<SpotifyMe> {
  if (cachedMe) return cachedMe;
  const res = await spotifyFetch('/v1/me');
  if (!res.ok) {
    throw new Error(`getMe: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string; display_name: string | null };
  cachedMe = { id: data.id, displayName: data.display_name };
  return cachedMe;
}

export function clearMeCache(): void {
  cachedMe = null;
}

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  isOwn: boolean;
  trackCount: number;
  /** Bei selbst-erstellten Playlists ohne Cover gibt Spotify ein leeres `images`-Array zurück. */
  coverUrl: string | null;
};

type RawPlaylist = {
  id: string;
  name: string;
  // Spotify liefert für gelegentlich kaputte/gelöschte Playlists null oder
  // unvollständige Sub-Objekte. Alle Felder defensiv typisieren.
  owner: { id: string; display_name: string | null } | null;
  // Track-Counter heißt in der aktuellen Spotify-API `items` (nicht `tracks`,
  // wie ältere Doku-Versionen suggerieren). Wir fallen defensiv auf `tracks`
  // zurück, falls Spotify das alte Feld irgendwo doch noch liefert.
  items?: { total: number } | null;
  tracks?: { total: number } | null;
  images: { url: string; width: number | null; height: number | null }[] | null;
};

/**
 * Listet alle Playlists des angemeldeten Users (eigene + abonnierte +
 * kollaborative). Paginiert die Spotify-Antwort durch, max. 50 pro Page.
 * Markiert `isOwn` via Match gegen `getMe().id`.
 *
 * Wirft `SpotifyScopeError`, wenn der Token den Scope nicht hat → Caller mappt
 * auf HTTP 401 `reauth_required`.
 */
export async function getMyPlaylistsPaginated(): Promise<SpotifyPlaylistSummary[]> {
  await requireScope('playlist-read-private');
  const me = await getMe();
  const out: SpotifyPlaylistSummary[] = [];
  let url: string | null = '/v1/me/playlists?limit=50';
  while (url) {
    const res: Response = await spotifyFetch(url);
    if (res.status === 403) {
      // Defensiver Fallback, falls Spotify trotz vorhandenem Scope-Token 403 liefert.
      throw new SpotifyScopeError('playlist-read-private');
    }
    if (!res.ok) {
      throw new Error(
        `getMyPlaylistsPaginated: ${res.status} ${await res.text()}`,
      );
    }
    const page = (await res.json()) as {
      items: (RawPlaylist | null)[] | null;
      next: string | null;
    };
    for (const p of page.items ?? []) {
      // Spotify liefert gelegentlich null-Items oder Playlists ohne Owner/Tracks
      // (gelöscht, kaputt, Migrationen). Solche Einträge überspringen statt crashen.
      if (!p || !p.id || !p.owner?.id) continue;
      out.push({
        id: p.id,
        name: p.name ?? '(ohne Namen)',
        ownerId: p.owner.id,
        ownerName: p.owner.display_name ?? p.owner.id,
        isOwn: p.owner.id === me.id,
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
        coverUrl: p.images?.[0]?.url ?? null,
      });
    }
    url = page.next
      ? page.next.replace('https://api.spotify.com', '')
      : null;
  }
  return out;
}
