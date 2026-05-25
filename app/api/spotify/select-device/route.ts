/**
 * Setzt das aktive Spotify-Connect-Device. `play: false` lässt einen
 * laufenden Pause-Zustand unverändert — der Host startet den ersten Track
 * manuell in der Spotify-App.
 */

import { z } from 'zod';
import { SpotifyNotConnectedError, transferPlayback } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  deviceId: z.string().min(1),
  play: z.boolean().optional(),
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
    await transferPlayback(parsed.data.deviceId, parsed.data.play ?? false);
    return Response.json({ ok: true });
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
