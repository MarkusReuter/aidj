/**
 * Plan2: Notfall-Lösch-Geste für eine Gast-Wunsch-Karte vom Tablet
 * (Long-Press-Confirm-Modal). Entfernt den Entry komplett aus der Gast-Queue
 * — Quota wird sofort frei, Slot wird beim nächsten `recomputeCandidates`
 * von einem LLM-Pick gefüllt.
 *
 * Bewusst eigene Route statt `DELETE /api/queue/[id]`, weil Next.js dynamic
 * routes ein Verzeichnis brauchen — eine zusätzliche flache Route-Datei
 * ist sauberer als die bestehende mit Verb-Switch zu erweitern.
 *
 * Response:
 *   200 + { ok: true }                     — entfernt (oder wurde nie da)
 *   422 + { error: 'invalid_body', ... }   — Validation-Fehler
 */

import { z } from 'zod';
import { removeGuestWish } from '@/lib/state';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  submissionId: z.string().min(8).max(128),
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

  await removeGuestWish(parsed.data.submissionId);
  return Response.json({ ok: true });
}
