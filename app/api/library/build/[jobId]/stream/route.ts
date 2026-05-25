/**
 * SSE-Stream für einen Library-Build-Job. Pattern parallel zu
 * `app/api/state/stream/route.ts`, aber pro Job statt globalem State.
 *
 * Verhalten:
 *   - Beim Connect: erst das gesamte bisherige `eventLog` rauspushen (Replay
 *     für späte Subscriber + Re-Attach nach Browser-Reconnect).
 *   - Wenn Job noch läuft: abonniere `EventEmitter` für weitere Events.
 *   - Wenn Job schon fertig (done/error): nur Replay, dann Stream schließen.
 *   - Heartbeat alle 15 s als SSE-Comment, damit Proxies/iOS nicht kappen.
 *
 * Cancel-Verhalten: bei `cancel()` des Streams (Tab geschlossen, Network-Loss)
 * wird **nur** die Subscription gelöst — der Job läuft serverseitig weiter
 * und schreibt am Ende `library.json`.
 */

import { getJob, type BuildProgressEvent } from '@/lib/library-build';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function eventToSse(e: BuildProgressEvent): string {
  // Wir wählen Event-Namen passend zum diskriminierten Union — Client kann
  // `eventSource.addEventListener('track', …)` etc. nutzen.
  return sse(e.kind, e);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return Response.json(
      { error: 'job_not_found', message: `Job ${jobId} unbekannt oder abgelaufen.` },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  let heartbeat: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Stream geschlossen — Cleanup läuft via `cancel`.
        }
      };

      // Replay bisheriger Events (für späte Subscriber / Re-Attach).
      for (const e of job.eventLog) push(eventToSse(e));

      const isFinished = job.status === 'done' || job.status === 'error';
      if (isFinished) {
        // Nichts mehr zu senden — close. Heartbeat braucht's auch nicht.
        try {
          controller.close();
        } catch {
          // ignore
        }
        return;
      }

      // Live-Subscription. EventEmitter feuert `event` bei jedem onProgress.
      const listener = (e: BuildProgressEvent) => {
        push(eventToSse(e));
        if (e.kind === 'done' || e.kind === 'error') {
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };
      job.emitter.on('event', listener);
      unsubscribe = () => job.emitter.off('event', listener);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          // ignore
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
