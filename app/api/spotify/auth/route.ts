/**
 * Startet den Spotify-OAuth-Flow.
 *
 * Setzt einen kurzlebigen HttpOnly-Cookie mit einem `state`-Token (CSRF-Schutz)
 * und redirected zu Spotify's Authorize-URL. Spotify schickt den User mit
 * demselben `state` zurück an /api/spotify/callback, wo der Cookie verifiziert
 * wird.
 */

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buildAuthorizeUrl, SpotifyConfigError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export const SPOTIFY_OAUTH_STATE_COOKIE = 'spotify_oauth_state';

export async function GET(): Promise<Response> {
  let url: string;
  try {
    const state = randomBytes(16).toString('hex');
    url = buildAuthorizeUrl(state);
    const cookieStore = await cookies();
    cookieStore.set(SPOTIFY_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 Minuten — länger braucht der User nicht zum Einloggen.
      // secure: false — wir laufen auf http://localhost / http://<lan-ip>.
    });
  } catch (err) {
    if (err instanceof SpotifyConfigError) {
      return new Response(err.message, { status: 500 });
    }
    throw err;
  }
  redirect(url);
}
