/**
 * Startet den Spotify-OAuth-Flow.
 *
 * Setzt einen kurzlebigen HttpOnly-Cookie mit einem `state`-Token (CSRF-Schutz)
 * und redirected zu Spotify's Authorize-URL. Spotify schickt den User mit
 * demselben `state` zurück an /api/spotify/callback, wo der Cookie verifiziert
 * wird.
 *
 * Implementierungs-Hinweis: in Route Handlers kann `cookies().set()` aus
 * `next/headers` in Kombination mit `redirect()` aus `next/navigation` den
 * Cookie unter die Räder kommen — `redirect()` baut die Response über einen
 * Throw, und die Cookie-Mutation muss erst noch geflusht werden. Wir bauen
 * deshalb explizit `NextResponse.redirect(...)` und setzen den Cookie auf
 * der Response selbst.
 */

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, SpotifyConfigError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export const SPOTIFY_OAUTH_STATE_COOKIE = 'spotify_oauth_state';

export async function GET(): Promise<Response> {
  let url: string;
  let state: string;
  try {
    state = randomBytes(16).toString('hex');
    url = buildAuthorizeUrl(state);
  } catch (err) {
    if (err instanceof SpotifyConfigError) {
      return new Response(err.message, { status: 500 });
    }
    throw err;
  }

  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: SPOTIFY_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 Minuten — länger braucht der User nicht zum Einloggen.
    // secure: false — wir laufen auf http://localhost / http://<lan-ip>.
  });
  return response;
}
