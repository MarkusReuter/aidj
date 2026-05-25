/**
 * Track-Search-Proxy für die Phone-Such-Box (Phase 3a).
 *
 *   GET /api/search?q=<query>&scope=playlist|all  (default `all`)
 *
 *   - `scope=playlist`: Substring-Match über `data/library.json`. Kein
 *     Spotify-Call → funktioniert auch ohne OAuth.
 *   - `scope=all`: Library-Match + Spotify-Search. Library-Hits zuerst
 *     (Host-Kuratiert ist semantisch besser als willkürliche Spotify-Treffer).
 *     URIs sind global eindeutig → bei Doppeltreffer gewinnt der Library-Eintrag,
 *     der zweite Spotify-Hit wird verworfen.
 *
 * Server-Cache (LRU mit TTL 60s): mehrere Gäste tippen oft denselben Prefix —
 * Cache spart Spotify-API-Quota und macht parallele Submissions schneller.
 */

import { loadLibrary, type LibraryTrack } from '@/lib/library';
import { searchSpotifyTracks, SpotifyNotConnectedError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

type Scope = 'playlist' | 'all';

type Hit = {
  id: string; // Spotify-URI
  title: string;
  artist: string;
  coverUrl: string;
  source: 'playlist' | 'spotify';
};

// ─────────────────────────────────────────────────────────────────────────────
// Sehr simpler TTL-Cache. Keine Eviction nach Size — für Hausparty-Traffic
// reicht das; bei längerer Laufzeit ist der memory-overhead vernachlässigbar.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: Hit[]; expiresAt: number }>();

function cacheGet(key: string): Hit[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    cache.delete(key);
    return null;
  }
  return e.value;
}

function cachePut(key: string, value: Hit[]): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─────────────────────────────────────────────────────────────────────────────
// Search-Implementierung.
// ─────────────────────────────────────────────────────────────────────────────

function libraryMatch(query: string, tracks: LibraryTrack[]): Hit[] {
  const q = query.toLowerCase();
  return tracks
    .filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q),
    )
    .map((t) => ({
      id: t.uri,
      title: t.title,
      artist: t.artist,
      coverUrl: t.coverUrl ?? '',
      source: 'playlist' as const,
    }));
}

async function spotifyMatch(query: string): Promise<Hit[]> {
  try {
    const hits = await searchSpotifyTracks(query);
    return hits.map((h) => ({
      id: h.uri,
      title: h.title,
      artist: h.artist,
      coverUrl: h.coverUrl ?? '',
      source: 'spotify' as const,
    }));
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      // Suche ohne Spotify-Connect funktioniert weiter, nur ohne Spotify-Hits.
      return [];
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawQ = url.searchParams.get('q') ?? '';
  const q = rawQ.trim();
  if (q.length === 0) {
    return Response.json({ results: [] });
  }
  if (q.length > 100) {
    return Response.json(
      { error: 'query_too_long', message: 'Query darf max. 100 Zeichen sein.' },
      { status: 400 },
    );
  }

  const scope = (url.searchParams.get('scope') ?? 'all') as Scope;
  if (scope !== 'playlist' && scope !== 'all') {
    return Response.json(
      { error: 'invalid_scope', message: "scope muss 'playlist' oder 'all' sein." },
      { status: 400 },
    );
  }

  const cacheKey = `${q.toLowerCase()}:${scope}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return Response.json({ results: cached, cached: true });
  }

  try {
    const library = await loadLibrary().catch(() => ({ tracks: [] }));
    const libHits = libraryMatch(q, library.tracks).slice(0, 8);

    let results: Hit[] = libHits;
    if (scope === 'all') {
      const spHits = await spotifyMatch(q);
      // Dedup gegen Library-Hits (URI ist eindeutig).
      const seen = new Set(libHits.map((h) => h.id));
      for (const h of spHits) {
        if (seen.has(h.id)) continue;
        results.push(h);
      }
      results = results.slice(0, 15);
    }

    cachePut(cacheKey, results);
    return Response.json({ results });
  } catch (err) {
    return Response.json(
      {
        error: 'search_error',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
