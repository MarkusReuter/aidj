/**
 * Startet einen Library-Build-Job (Phase 4b). Two-Step-SSE:
 *   1. `POST /api/library/build` → `{jobId}` (dieser Endpoint).
 *   2. `GET /api/library/build/:jobId/stream` → SSE-Stream der Progress-Events.
 *
 * Vorteile gegenüber POST-with-SSE-Body:
 *   - Browser kann nativen `EventSource` benutzen (Auto-Reconnect, robustes
 *     Frame-Parsing, korrekte UTF-8-Behandlung).
 *   - Mehrere Tabs können denselben Stream parallel zuschauen.
 *   - Browser-Tab schließen mid-Build verliert keinen Fortschritt — der Job
 *     läuft serverseitig weiter und schreibt am Ende `library.json`.
 *
 * Single-Build-Constraint: nur ein Build gleichzeitig. Zweiter POST → 409 mit
 * `{error: 'build_in_progress', jobId: <aktive>}` — Client kann am laufenden
 * Stream attachen statt zu warten.
 */

import {
  getActiveJobId,
  isRunning,
  startBuildJob,
} from '@/lib/library-build';
import {
  requireScope,
  spotifyFetch,
  SpotifyNotConnectedError,
  SpotifyScopeError,
} from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { playlistIds?: unknown }).playlistIds) ||
    (body as { playlistIds: unknown[] }).playlistIds.length === 0 ||
    !(body as { playlistIds: unknown[] }).playlistIds.every(
      (id) => typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id),
    )
  ) {
    return Response.json(
      {
        error: 'invalid_body',
        message:
          'Erwarte { playlistIds: string[] } mit mindestens einer Playlist-ID (Base62).',
      },
      { status: 400 },
    );
  }
  const playlistIds = (body as { playlistIds: string[] }).playlistIds;

  if (isRunning()) {
    return Response.json(
      {
        error: 'build_in_progress',
        jobId: getActiveJobId(),
        message:
          'Es läuft schon ein Build. Streame den existierenden Job statt einen neuen zu starten.',
      },
      { status: 409 },
    );
  }

  try {
    // Frühe Auth-Checks: scheitern hier statt erst mitten im Build-Job.
    // `requireScope` deckt den Scope ab (`SpotifyScopeError`), die `/v1/me`-Probe
    // den Token-Live-Status (z.B. revoked nach Passwort-Change).
    await requireScope('playlist-read-private');
    const probe = await spotifyFetch('/v1/me');
    if (probe.status === 401) {
      return Response.json(
        { error: 'not_connected', message: 'Spotify-Token ungültig.' },
        { status: 401 },
      );
    }
    if (probe.status === 403) {
      return Response.json(
        {
          error: 'reauth_required',
          message: 'Spotify-Scope unzureichend.',
        },
        { status: 401 },
      );
    }
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return Response.json(
        { error: 'not_connected', message: err.message },
        { status: 401 },
      );
    }
    if (err instanceof SpotifyScopeError) {
      return Response.json(
        { error: 'reauth_required', message: err.message },
        { status: 401 },
      );
    }
    return Response.json(
      {
        error: 'spotify_error',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const bpmKey = process.env.GETSONGBPM_API_KEY ?? null;

  try {
    const job = startBuildJob({
      playlistIds,
      fetchSpotify: spotifyFetch,
      bpmKey,
    });
    return Response.json(
      { jobId: job.id, bpmEnabled: bpmKey !== null },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'build_in_progress') {
      return Response.json(
        {
          error: 'build_in_progress',
          jobId: getActiveJobId(),
          message: 'Build wurde gerade von einem anderen Tab gestartet.',
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error: 'start_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
