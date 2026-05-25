/**
 * build-library.ts (CLI-Wrapper)
 *
 *   npx tsx scripts/build-library.ts <playlist-uri-or-url> [<playlist-uri-or-url> ...]
 *
 * Power-User-/CI-Fallback. Primärer Weg ist seit Phase 4b die `/admin`-UI.
 *
 * Authentifizierung: Spotify Client-Credentials (App-Only, kein User-Login).
 * Limitation: Liest **nur public Playlists**. Eigene private Playlists nur
 * über `/admin` (nutzt User-OAuth).
 *
 * Build-Logik lebt in `lib/library-build.ts` und wird von /admin geteilt —
 * Concurrency 2 + 500ms-Inter-Sleep, BPM-Preservation, 429/5xx-Backoff.
 *
 * Voraussetzungen:
 *   - `.env.local` mit SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
 *   - optional GETSONGBPM_API_KEY (ohne den bleibt `bpm: null`)
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildLibraryFromPlaylists,
  parsePlaylistId,
  type BuildProgressEvent,
  type SpotifyFetch,
} from '../lib/library-build';
import { emptyLibrary, loadLibrary, saveLibrary } from '../lib/library';

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

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

async function getClientCredentialsToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET fehlen in .env.local.',
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

/**
 * Baut eine `SpotifyFetch`-Funktion über den Client-Credentials-Token. Damit
 * ist die Signatur identisch zur Web-Variante in `lib/spotify.ts::spotifyFetch`,
 * und `lib/library-build.ts` kann beide gleich behandeln.
 */
function makeClientCredentialsFetch(token: string): SpotifyFetch {
  return async (path, init = {}) => {
    const url = path.startsWith('http') ? path : `https://api.spotify.com${path}`;
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };
}

function logProgress(e: BuildProgressEvent): void {
  switch (e.kind) {
    case 'phase':
      console.log(e.message);
      break;
    case 'progress':
      if (e.currentIndex % 10 === 0 || e.currentIndex === e.totalTracks) {
        console.log(
          `  Track ${e.currentIndex}/${e.totalTracks} · BPM-Hits ${e.bpmHits} · Misses ${e.bpmMisses}`,
        );
      }
      break;
    case 'done':
      console.log(
        `\nFertig: ${e.addedCount} neu hinzugefügt · ${e.alreadyPresentCount} schon im Bestand (skipped) · BPM-Hits ${e.bpmHits} · Library-Total: ${e.trackCount}.`,
      );
      break;
    case 'error':
      console.error(`Build-Fehler: ${e.message}`);
      break;
    // 'track' ignorieren — zu laut für CLI.
  }
}

async function main(): Promise<void> {
  await loadEnvLocal();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'Usage: npx tsx scripts/build-library.ts <playlist-uri-or-url> [<playlist-uri-or-url> ...]',
    );
    console.error('Hinweis: CLI liest nur public Playlists. Private → /admin.');
    process.exit(1);
  }
  const playlistIds = args.map(parsePlaylistId);

  const bpmKey = process.env.GETSONGBPM_API_KEY ?? null;
  if (!bpmKey) {
    console.warn(
      'GETSONGBPM_API_KEY fehlt — BPM bleibt null (DJ-Brain ignoriert BPM-Bedingungen).',
    );
  }

  const token = await getClientCredentialsToken();
  const fetchSpotify = makeClientCredentialsFetch(token);

  const existing = await loadLibrary().catch(() => emptyLibrary());

  const library = await buildLibraryFromPlaylists({
    playlistIds,
    fetchSpotify,
    bpmKey,
    existing,
    onProgress: logProgress,
  });

  await saveLibrary(library);
}

main().catch((err: unknown) => {
  console.error('build-library failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
