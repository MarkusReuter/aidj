/**
 * Spotify-OAuth-Callback. Verifiziert den state-Cookie, tauscht den Code gegen
 * Access+Refresh-Token und speichert beides via `lib/spotify.ts` auf Disk.
 *
 * Bei Erfolg → Redirect auf `/admin?spotify=connected` (Library-Editor sieht
 * den Hinweis und kann sich später dort spotify-spezifische Statuszeile holen).
 * Bei Fehler → HTML-Seite mit Fehlermeldung, weil der User in einem Browser-Tab
 * gelandet ist und JSON nicht hilfreich wäre.
 *
 * Implementierungs-Hinweis: lesen via `request.cookies` (Request-bound, immer
 * frisch), schreiben via `NextResponse`-Objekt — gleicher Grund wie im
 * Auth-Start-Handler (cookies()/redirect() ist in Route Handlers historisch
 * flackrig).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCodeForToken, SpotifyConfigError } from '@/lib/spotify';
import { SPOTIFY_OAUTH_STATE_COOKIE } from '../auth/route';

export const dynamic = 'force-dynamic';

function errorPage(title: string, detail: string): NextResponse {
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
  const res = new NextResponse(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  // State-Cookie räumen, falls noch einer rumhängt.
  res.cookies.delete(SPOTIFY_OAUTH_STATE_COOKIE);
  return res;
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

  const storedState = request.cookies.get(SPOTIFY_OAUTH_STATE_COOKIE)?.value;

  if (!storedState) {
    return errorPage(
      'State-Cookie fehlt',
      [
        'Der CSRF-State-Cookie ist beim Callback nicht angekommen.',
        '',
        'Mögliche Ursachen:',
        '  • Die App und SPOTIFY_REDIRECT_URI nutzen unterschiedliche Origins',
        '    (z.B. App auf http://192.168.x.x:3000 geöffnet, aber',
        '     SPOTIFY_REDIRECT_URI=http://localhost:3000/...).',
        '    → Öffne /admin auf demselben Host wie die Redirect-URI.',
        '  • Browser blockt Third-Party-/Cross-Site-Cookies (Safari Strict Mode).',
        '    → Anderer Browser oder Incognito-Tab testen.',
        '  • Cookie ist abgelaufen (>10 Minuten zwischen Klick & Callback).',
        '',
        'Starte den Flow erneut.',
      ].join('\n'),
    );
  }

  if (storedState !== state) {
    return errorPage(
      'State-Mismatch (CSRF-Schutz)',
      [
        `Cookie-State: ${storedState.slice(0, 8)}…`,
        `URL-State:    ${state.slice(0, 8)}…`,
        '',
        'Typisch: Auth wurde in zwei Tabs parallel gestartet — der zweite Tab',
        'hat den Cookie überschrieben, dann ist der erste Tab zurückgekommen.',
        'Schließe alle /api/spotify/auth-Tabs und starte einmal frisch.',
      ].join('\n'),
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

  const res = NextResponse.redirect(new URL('/admin?spotify=connected', request.url));
  res.cookies.delete(SPOTIFY_OAUTH_STATE_COOKIE);
  return res;
}
