/**
 * Spotify-OAuth-Callback. Verifiziert den state-Cookie, tauscht den Code gegen
 * Access+Refresh-Token und speichert beides via `lib/spotify.ts` auf Disk.
 *
 * Bei Erfolg → Redirect auf `/admin?spotify=connected` (Library-Editor sieht
 * den Hinweis und kann sich später dort spotify-spezifische Statuszeile holen).
 * Bei Fehler → HTML-Seite mit Fehlermeldung, weil der User in einem Browser-Tab
 * gelandet ist und JSON nicht hilfreich wäre.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { exchangeCodeForToken, SpotifyConfigError } from '@/lib/spotify';
import { SPOTIFY_OAUTH_STATE_COOKIE } from '../auth/route';

export const dynamic = 'force-dynamic';

function errorPage(title: string, detail: string): Response {
  const safeTitle = title.replace(/</g, '&lt;');
  const safeDetail = detail.replace(/</g, '&lt;');
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Spotify-Auth fehlgeschlagen</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#eee;max-width:42rem;margin:4rem auto;padding:0 1rem;line-height:1.5}h1{color:#f87171}a{color:#a78bfa}</style>
</head><body>
<h1>Spotify-Auth fehlgeschlagen</h1>
<p><strong>${safeTitle}</strong></p>
<pre style="background:#1a1a1a;padding:1rem;border-radius:.5rem;white-space:pre-wrap">${safeDetail}</pre>
<p><a href="/api/spotify/auth">Erneut versuchen</a></p>
</body></html>`;
  return new Response(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const error = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (error) {
    return errorPage(
      'Spotify hat den Login abgelehnt',
      `Fehler-Code: ${error}\n\nTypisch: Account ist nicht als Test-User im Dev-Dashboard eingetragen,\noder der User hat den Consent-Dialog abgebrochen.`,
    );
  }

  if (!code || !state) {
    return errorPage(
      'Unvollständiger Callback',
      'Es fehlen `code` oder `state` in der URL. Starte den Flow neu über /api/spotify/auth.',
    );
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get(SPOTIFY_OAUTH_STATE_COOKIE)?.value;
  // State-Cookie immer löschen — egal ob Verifikation klappt oder nicht.
  cookieStore.delete(SPOTIFY_OAUTH_STATE_COOKIE);

  if (!storedState || storedState !== state) {
    return errorPage(
      'State-Mismatch (CSRF-Schutz)',
      'Der `state`-Parameter aus der Spotify-Response passt nicht zum Cookie. Browser-Cookies geblockt? Anderer Tab? Starte den Flow neu.',
    );
  }

  try {
    await exchangeCodeForToken(code);
  } catch (err) {
    if (err instanceof SpotifyConfigError) {
      return errorPage('Konfiguration unvollständig', err.message);
    }
    return errorPage(
      'Token-Exchange fehlgeschlagen',
      err instanceof Error ? err.message : String(err),
    );
  }

  redirect('/admin?spotify=connected');
}
