import { z } from 'zod';
import {
  LibrarySchema,
  loadLibrary,
  saveLibrary,
  type Library,
} from '@/lib/library';
import { isRunning as isBuildRunning } from '@/lib/library-build';
import { refreshLibrary } from '@/lib/state';

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
 *
 * Race-Schutz (Phase 4b): Während eines aktiven Library-Builds wird der Save
 * mit 409 abgelehnt. Sonst würde der Editor-Save entweder Build-Output
 * vorab überschreiben oder am Ende vom Build überschrieben werden — beides
 * frisst Mood-Tags/Energy-Edits.
 */
export async function PUT(request: Request): Promise<Response> {
  if (isBuildRunning()) {
    return Response.json(
      {
        error: 'build_in_progress',
        message:
          'Library wird gerade gebaut — Save danach erneut versuchen.',
      },
      { status: 409 },
    );
  }

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

  // Second-Check kurz vorm Schreiben: Build könnte zwischen der ersten Prüfung
  // und jetzt gestartet sein. Race-Window ist winzig, aber sauber zu schließen.
  if (isBuildRunning()) {
    return Response.json(
      {
        error: 'build_in_progress',
        message:
          'Library wird gerade gebaut — Save danach erneut versuchen.',
      },
      { status: 409 },
    );
  }

  await saveLibrary(parsed.data);
  // Cache verwerfen + Kandidaten sofort neu mischen, damit Edits (Tags/Energy/
  // Key, entfernte Tracks) ohne App-Neustart wirksam sind. Bewusst await, damit
  // ein direkt folgendes GET/SSE schon den frischen Stand sieht.
  await refreshLibrary();
  return Response.json({ ok: true, trackCount: parsed.data.tracks.length });
}
