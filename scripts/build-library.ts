/**
 * build-library.ts
 *
 * Einmal pro Party-Vorbereitung am Mac:
 *   npx tsx scripts/build-library.ts <playlist-uri> [<playlist-uri> ...]
 *
 * Lädt für jede angegebene Spotify-Playlist alle Tracks, holt Artist-Genres
 * (Spotify API) + BPM (GetSongBPM API) und schreibt das Resultat nach
 * `data/library.json`. Vorhandene `moodTags` + `energyLevel` pro Track-URI
 * werden aus der existierenden Library übernommen — Editor-Arbeit geht nicht
 * verloren beim Re-Build.
 *
 * Voraussetzungen:
 *   - `.env.local` mit SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
 *   - optional GETSONGBPM_API_KEY (ohne den bleibt `bpm: null`)
 *
 * Spotify-Auth: Client Credentials Flow (App-Only). Kein User-Token nötig —
 * Playlist-Reads + Artist-Lookups sind nicht user-gated. Der OAuth-Flow für
 * Queue-Control kommt erst in PLAN-Phase 3.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  emptyLibrary,
  loadLibrary,
  saveLibrary,
  type Library,
  type LibraryTrack,
} from '../lib/library';

// .env.local manuell parsen — keine dotenv-Dependency, halten wir slim.
async function loadEnvLocal(): Promise<void> {
  const path = join(process.cwd(), '.env.local');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parsePlaylistId(arg: string): string {
  // Akzeptiert `spotify:playlist:ID`, eine offene URL oder die nackte ID.
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(arg);
  if (uriMatch) return uriMatch[1];
  const urlMatch = /^https?:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/.exec(
    arg,
  );
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9]+$/.test(arg)) return arg;
  throw new Error(`Konnte Playlist-ID aus "${arg}" nicht extrahieren.`);
}

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

async function getSpotifyToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET fehlen in .env.local.\n' +
        'Setup: https://developer.spotify.com/dashboard → App registrieren → Client ID + Secret kopieren.',
    );
  }
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(
      `Spotify-Token-Request gescheitert: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as SpotifyTokenResponse;
  return data.access_token;
}

type SpotifyPlaylistTrack = {
  track: {
    uri: string;
    name: string;
    duration_ms: number;
    is_local: boolean;
    artists: { id: string; name: string }[];
    album: {
      images: { url: string; width: number; height: number }[];
    };
  } | null;
};

type SpotifyPlaylistTracksResponse = {
  items: SpotifyPlaylistTrack[];
  next: string | null;
};

async function fetchPlaylistTracks(
  playlistId: string,
  token: string,
): Promise<SpotifyPlaylistTrack[]> {
  const all: SpotifyPlaylistTrack[] = [];
  let url:
    | string
    | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=0`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `Spotify-Playlist ${playlistId} gescheitert: ${res.status} ${await res.text()}`,
      );
    }
    const page = (await res.json()) as SpotifyPlaylistTracksResponse;
    all.push(...page.items);
    url = page.next;
  }
  return all;
}

type SpotifyArtist = { id: string; name: string; genres: string[] };

async function fetchArtistsBulk(
  ids: string[],
  token: string,
): Promise<Map<string, SpotifyArtist>> {
  const map = new Map<string, SpotifyArtist>();
  // Spotify-Limit: 50 IDs pro Bulk-Request.
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://api.spotify.com/v1/artists?ids=${chunk.join(',')}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `Spotify-Artists-Lookup gescheitert: ${res.status} ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { artists: SpotifyArtist[] };
    for (const a of data.artists) {
      if (a) map.set(a.id, a);
    }
  }
  return map;
}

type GetSongBpmResponse = {
  search:
    | {
        song_title: string;
        artist: { name: string };
        tempo?: string | number;
      }[]
    | { error: string };
};

async function fetchBpm(
  title: string,
  artist: string,
  apiKey: string,
): Promise<number | null> {
  const lookup = `song:${title.replace(/[()[\]]/g, '').trim()} artist:${artist.replace(/[()[\]]/g, '').trim()}`;
  const url = `https://api.getsongbpm.com/search/?api_key=${encodeURIComponent(
    apiKey,
  )}&type=both&lookup=${encodeURIComponent(lookup)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as GetSongBpmResponse;
    if (!Array.isArray(data.search)) return null;
    const tempo = data.search[0]?.tempo;
    if (tempo == null) return null;
    const n = Number(tempo);
    return Number.isFinite(n) && n >= 40 && n <= 220 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  await loadEnvLocal();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'Usage: npx tsx scripts/build-library.ts <playlist-uri-or-url> [<playlist-uri-or-url> ...]',
    );
    process.exit(1);
  }
  const playlistIds = args.map(parsePlaylistId);

  const token = await getSpotifyToken();

  let existing: Library;
  try {
    existing = await loadLibrary();
  } catch {
    existing = emptyLibrary();
  }
  // URI → bestehende manuelle Tags. Beim Re-Build behalten wir die Editor-Arbeit.
  const preservedByUri = new Map<
    string,
    { moodTags: LibraryTrack['moodTags']; energyLevel: number | null }
  >();
  for (const t of existing.tracks) {
    preservedByUri.set(t.uri, {
      moodTags: t.moodTags,
      energyLevel: t.energyLevel,
    });
  }

  console.log(`Lade ${playlistIds.length} Playlist(s) von Spotify...`);
  const seenUris = new Set<string>();
  const rawTracks: SpotifyPlaylistTrack['track'][] = [];
  for (const pid of playlistIds) {
    const items = await fetchPlaylistTracks(pid, token);
    for (const item of items) {
      const t = item.track;
      if (!t || t.is_local) continue;
      if (seenUris.has(t.uri)) continue;
      seenUris.add(t.uri);
      rawTracks.push(t);
    }
    console.log(`  ${pid}: ${items.length} Items (kumuliert ${rawTracks.length} unique Tracks)`);
  }

  // Alle Artist-IDs für Bulk-Lookup einsammeln.
  const artistIds = Array.from(
    new Set(rawTracks.flatMap((t) => t!.artists.map((a) => a.id))),
  );
  console.log(`Hole Genres für ${artistIds.length} Artists...`);
  const artistMap = await fetchArtistsBulk(artistIds, token);

  const bpmKey = process.env.GETSONGBPM_API_KEY;
  if (!bpmKey) {
    console.warn(
      'GETSONGBPM_API_KEY fehlt — BPM bleibt null (DJ-Brain wird BPM-Bedingungen dann ignorieren).\n' +
        'Optional: API-Key kostenlos beantragen unter https://getsongbpm.com/api',
    );
  }

  const tracks: LibraryTrack[] = [];
  let bpmHits = 0;
  for (let i = 0; i < rawTracks.length; i++) {
    const t = rawTracks[i]!;
    const genres = Array.from(
      new Set(
        t.artists.flatMap((a) => artistMap.get(a.id)?.genres ?? []),
      ),
    );

    let bpm: number | null = null;
    if (bpmKey) {
      bpm = await fetchBpm(t.name, t.artists[0]?.name ?? '', bpmKey);
      if (bpm !== null) bpmHits += 1;
      // Sanftes Rate-Limit für GetSongBPM (Free-Tier ~ 1 req/s).
      await sleep(1100);
    }

    const preserved = preservedByUri.get(t.uri);
    const coverUrl = t.album.images[0]?.url ?? null;

    tracks.push({
      uri: t.uri,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      coverUrl,
      durationMs: t.duration_ms,
      spotifyGenres: genres,
      bpm,
      moodTags: preserved?.moodTags ?? [],
      energyLevel: preserved?.energyLevel ?? null,
    });

    if ((i + 1) % 10 === 0 || i === rawTracks.length - 1) {
      console.log(
        `  Track ${i + 1}/${rawTracks.length} · BPM-Hits: ${bpmHits}`,
      );
    }
  }

  const library: Library = {
    builtAt: new Date().toISOString(),
    tracks,
  };
  await saveLibrary(library);
  console.log(
    `\nFertig: ${tracks.length} Tracks geschrieben. BPM-Lookups: ${bpmHits}/${tracks.length}. ${
      preservedByUri.size > 0
        ? `Behalten: Mood-Tags + Energy für ${
            tracks.filter((t) => preservedByUri.has(t.uri)).length
          } bereits getaggte Tracks.`
        : ''
    }`,
  );
}

main().catch((err: unknown) => {
  console.error('build-library failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
