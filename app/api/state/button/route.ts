/**
 * Empfängt Button-Presses vom Tablet/Phone und mutiert den Server-State.
 *
 *   { type: "mood",     value: "<mood-value>"  }   → moodCounts++ → SSE-Update
 *   { type: "playlist", value: "<playlist>"    }   → activePlaylists toggle → SSE
 *   { type: "anti",     value: "dislike"|"love"}   → AntiCount++, kein UI-Update
 *
 * 200 reicht — der eigentliche State-Update kommt per SSE an alle Clients
 * zurück, der Caller braucht keine echte Response-Daten.
 */

import { z } from 'zod';
import { recordAntiPress, recordMoodPress, togglePlaylist } from '@/lib/state';

export const dynamic = 'force-dynamic';

const BodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mood'), value: z.string().min(1) }),
  z.object({ type: z.literal('playlist'), value: z.string().min(1) }),
  z.object({ type: z.literal('anti'), value: z.enum(['dislike', 'love']) }),
]);

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
  switch (parsed.data.type) {
    case 'mood':
      recordMoodPress(parsed.data.value);
      break;
    case 'playlist':
      togglePlaylist(parsed.data.value);
      break;
    case 'anti':
      recordAntiPress(parsed.data.value);
      break;
  }
  return Response.json({ ok: true });
}
