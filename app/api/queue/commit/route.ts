/**
 * Crowd-Tap auf eine Kandidaten-Karte. Setzt den server-side committedId-Flag
 * UND pusht den Track sofort ans Ende der Spotify-Queue.
 *
 * Phase-4-Vereinfachung: "Tap = sofort queueen" statt "Tap = warten bis
 * Lock-Window ~10s vor Track-Ende". Die Lock-Window-Logik kommt erst mit dem
 * DJ-Brain in Phase 5, der Auto-Pick + Re-Pick-Übersteuerung im selben Window
 * orchestriert. Bis dahin: sofort queueen ist berechenbar und gut testbar.
 *
 * 404-vom-Spotify (kein aktives Device) wird als 409 surface'd, damit das
 * UI eine "Wähle Device"-Aktion vorschlagen kann.
 */

import { z } from 'zod';
import { addToQueue, SpotifyNotConnectedError } from '@/lib/spotify';
import { commitCandidate, getSnapshot } from '@/lib/state';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  trackId: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/, 'Erwarte spotify:track:<id>'),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_body', issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }
  const { trackId } = parsed.data;

  // Optimistic: erst den committed-Flag setzen (SSE pusht das sofort an alle
  // Tablets), dann den Spotify-Call machen. Wenn Spotify scheitert, geben wir
  // einen Fehler zurück — der Caller kann den Commit clientseitig
  // zurückrollen, aber für die Phase 4-UX reicht "Toast + Karte bleibt
  // markiert" weil sie ja wirklich der gewählte ist.
  const ok = commitCandidate(trackId);
  if (!ok) {
    return Response.json(
      {
        error: 'not_a_candidate',
        message: 'Track ist nicht in den aktuellen Kandidaten — Snapshot veraltet?',
        snapshot: getSnapshot(),
      },
      { status: 409 },
    );
  }

  try {
    await addToQueue(trackId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json({ error: 'not_connected', message: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Kein aktives Spotify-Device')) {
      return Response.json({ error: 'no_active_device', message: msg }, { status: 409 });
    }
    return Response.json({ error: 'spotify_error', message: msg }, { status: 502 });
  }
}
