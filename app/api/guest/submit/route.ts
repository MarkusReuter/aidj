/**
 * Phone-Submission: Gast wählt einen Track (entweder Tap auf Kandidaten-
 * Karte oder Pick aus der Such-Autocomplete). Track landet in der
 * Server-Gast-Queue (FIFO + 1-Slot-Quota) UND wird an Spotify gequeued.
 *
 * Body:
 *   { trackUri, trackMeta, submissionId, guestName }
 * Header:
 *   X-Guest-Id: <uuid>
 *
 * Response:
 *   201 + { entry, position, deduped }       — erfolgreich (oder Idempotency-Hit)
 *   401 + { error: "not_connected" }         — Spotify nicht verbunden
 *   409 + { error: "quota_exceeded", current } — Gast hat schon einen Track in der Queue
 *   409 + { error: "queue_full" }            — Gesamte Gast-Queue ist voll (10 pending)
 *   409 + { error: "no_active_device" }      — Spotify-App ist nicht aktiv
 *   422 + { error: "invalid_body", issues }  — Validation-Fehler
 *   502 + { error: "spotify_error" }         — sonstiger Spotify-Fehler
 */

import { z } from 'zod';
import { submitGuestTrack } from '@/lib/state';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  trackUri: z
    .string()
    .regex(/^spotify:track:[A-Za-z0-9]+$/, 'Erwarte spotify:track:<id>'),
  trackMeta: z.object({
    title: z.string().min(1),
    artist: z.string().min(1),
    coverUrl: z.string(),
    durationMs: z.number().int().positive(),
  }),
  submissionId: z.string().min(8).max(128),
  guestName: z.string().min(1).max(40),
});

const GUEST_ID_HEADER = 'x-guest-id';
const GuestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export async function POST(request: Request): Promise<Response> {
  const guestIdRaw = request.headers.get(GUEST_ID_HEADER);
  if (!guestIdRaw) {
    return Response.json(
      { error: 'missing_guest_id', message: `${GUEST_ID_HEADER}-Header fehlt.` },
      { status: 400 },
    );
  }
  const guestIdParsed = GuestIdSchema.safeParse(guestIdRaw);
  if (!guestIdParsed.success) {
    return Response.json({ error: 'invalid_guest_id' }, { status: 400 });
  }
  const guestId = guestIdParsed.data;

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

  const result = await submitGuestTrack({
    guestId,
    guestName: parsed.data.guestName,
    trackUri: parsed.data.trackUri,
    trackMeta: parsed.data.trackMeta,
    submissionId: parsed.data.submissionId,
  });

  if (result.ok) {
    return Response.json(
      {
        ok: true,
        entry: result.entry,
        position: result.position,
        deduped: result.deduped,
      },
      { status: 201 },
    );
  }
  switch (result.error) {
    case 'quota_exceeded':
      return Response.json(
        {
          error: 'quota_exceeded',
          message: 'Du hast schon einen Track in der Queue.',
          current: result.current,
        },
        { status: 409 },
      );
    case 'queue_full':
      return Response.json(
        {
          error: 'queue_full',
          message: 'Die Gast-Queue ist voll. Warte, bis ein Track gespielt wurde.',
        },
        { status: 409 },
      );
    case 'not_connected':
      return Response.json(
        { error: 'not_connected', message: result.message },
        { status: 401 },
      );
    case 'no_active_device':
      return Response.json(
        { error: 'no_active_device', message: result.message },
        { status: 409 },
      );
    case 'spotify_error':
      return Response.json(
        { error: 'spotify_error', message: result.message },
        { status: 502 },
      );
  }
}
