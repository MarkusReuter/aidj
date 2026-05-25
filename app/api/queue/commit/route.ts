/**
 * Host-Tap auf eine Kandidaten-Karte (Tablet). Setzt nur den server-side
 * committedId-Flag. Plan2: kein direkter Spotify-Queue-Push mehr — das
 * passiert ausschließlich im Lock-Window (~10 s vor Track-Ende) oder im
 * Skip-Pfad. So gibt es nur EINEN "nächster Track"-Begriff = `committedId`,
 * und Spotify wird nicht mit veralteten Picks gefüttert, falls der DJ
 * zwischendurch umentscheidet.
 *
 * 409 `not_a_candidate` wenn der Track-ID nicht (mehr) in der aktuellen
 * Kandidaten-Liste ist (z.B. wegen Snapshot-Race).
 */

import { z } from 'zod';
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

  return Response.json({ ok: true });
}
