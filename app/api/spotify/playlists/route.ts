/**
 * Listet die Playlists des angemeldeten Users (eigene + abonnierte +
 * kollaborative). Für den `/admin`-Library-Build-Picker (Phase 4b).
 *
 * Mapping auf HTTP-Status:
 *   - `SpotifyNotConnectedError` → 401 `not_connected` (kein Token auf Disk)
 *   - `SpotifyScopeError`        → 401 `reauth_required` (Token zu alt für Scope)
 *   - sonst                      → 502 `spotify_error`
 *
 * Die UI rendert in beiden 401-Fällen den "Spotify neu verbinden"-Banner und
 * verlinkt auf `/api/spotify/auth`.
 */

import {
  getMyPlaylistsPaginated,
  SpotifyNotConnectedError,
  SpotifyScopeError,
} from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const playlists = await getMyPlaylistsPaginated();
    return Response.json({ playlists });
  } catch (err) {
    if (err instanceof SpotifyScopeError) {
      return Response.json(
        {
          error: 'reauth_required',
          missingScope: err.missingScope,
          message: err.message,
        },
        { status: 401 },
      );
    }
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json(
        { error: 'not_connected', message: err.message },
        { status: 401 },
      );
    }
    return Response.json(
      {
        error: 'spotify_error',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
