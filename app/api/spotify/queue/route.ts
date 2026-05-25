/**
 * Hängt einen Track ans Ende der Spotify-Queue. Wird in Phase 4 vom
 * Kandidaten-Tap auf dem Tablet und vom DJ-Brain im Lock-Window aufgerufen.
 *
 * 404 vom Spotify-Endpoint = kein aktives Device — wird als 409 surface'd,
 * damit das UI "Device wählen"-Flow anzeigen kann statt nur "Server-Fehler".
 */

import { z } from 'zod';
import { addToQueue, SpotifyNotConnectedError } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/, 'Erwarte spotify:track:<id>'),
  deviceId: z.string().optional(),
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
  try {
    await addToQueue(parsed.data.uri, parsed.data.deviceId);
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
