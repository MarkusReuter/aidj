/**
 * Skip-Endpoint (Phase 5): drückt den aktuellen Track weiter, räumt die
 * Gast-Queue auf und triggert die Brain-Re-Rank-Pipeline. Sowohl Tablet
 * (`⏭ Skip Jetzt`) als auch Phone-DJ-Mode benutzen denselben Endpoint —
 * idempotent gegen Doppel-Klick (Spotify gibt einfach erneut `next` weiter).
 */

import { skipCurrentTrack } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const result = await skipCurrentTrack();
  if (result.ok) {
    return Response.json({ ok: true });
  }
  const status =
    result.error === 'not_connected' || result.error === 'no_active_device'
      ? 409
      : 502;
  return Response.json({ error: result.error, message: result.message }, { status });
}
