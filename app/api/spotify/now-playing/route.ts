/**
 * Proxiert `/me/player`. 204 von Spotify (= nichts läuft) wird auf 200 + `null`
 * gemappt, damit der Caller einen einheitlichen JSON-Shape bekommt.
 *
 * Phase 3: ad-hoc-Pull. Phase 4 startet darauf ein Server-side 5s-Polling-
 * Interval und pusht via SSE; dieser Endpoint bleibt als Debug-Hilfe nutzbar.
 */

import { getCurrentTrack, SpotifyNotConnectedError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const nowPlaying = await getCurrentTrack();
    return Response.json({ nowPlaying });
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json({ error: 'not_connected', message: err.message }, { status: 401 });
    }
    return Response.json(
      { error: 'spotify_error', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
