/**
 * Status-Endpoint für /admin: meldet ob Spotify verbunden ist, mit welchem
 * User, und ob die für Phase 4b nötigen Scopes (`playlist-read-private`)
 * verfügbar sind. UI nutzt das, um proaktiv einen Connect-/Re-Connect-Banner
 * anzuzeigen, statt erst bei der ersten API-Aktion einen 401 zu provozieren.
 */

import {
  getMe,
  hasScope,
  isConnected,
  SpotifyNotConnectedError,
} from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!(await isConnected())) {
    return Response.json({
      connected: false,
      hasPlaylistScope: false,
      user: null,
    });
  }
  try {
    const playlistScope = await hasScope('playlist-read-private');
    let user: { id: string; displayName: string | null } | null = null;
    if (playlistScope) {
      const me = await getMe();
      user = { id: me.id, displayName: me.displayName };
    }
    return Response.json({
      connected: true,
      hasPlaylistScope: playlistScope,
      user,
    });
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json({
        connected: false,
        hasPlaylistScope: false,
        user: null,
      });
    }
    // Token da, aber Spotify lehnt ab (revoked etc.) — wie "nicht verbunden" behandeln.
    return Response.json({
      connected: false,
      hasPlaylistScope: false,
      user: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
