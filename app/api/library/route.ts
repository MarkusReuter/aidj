import { z } from 'zod';
import {
  LibrarySchema,
  loadLibrary,
  saveLibrary,
  type Library,
} from '@/lib/library';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const library = await loadLibrary();
  return Response.json(library satisfies Library);
}

/**
 * Patch-Endpoint: nimmt eine vollständige Library entgegen, validiert via Zod
 * und überschreibt `data/library.json` atomar. Admin-UI ist die einzige
 * Quelle — kein Merge, kein optimistic-locking. Wenn zwei Tabs gleichzeitig
 * speichern, gewinnt der letzte (lokales Tool, ein User → akzeptabel).
 */
export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const parsed = LibrarySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_library',
        issues: z.treeifyError(parsed.error),
      },
      { status: 422 },
    );
  }

  await saveLibrary(parsed.data);
  return Response.json({ ok: true, trackCount: parsed.data.tracks.length });
}
