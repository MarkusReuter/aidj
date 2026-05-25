/**
 * SSE-Endpoint: pusht den `StateSnapshot` an alle verbundenen Tablets/Phones.
 *
 * Lifecycle:
 *   - Beim Connect: sofort einen `snapshot`-Event mit dem aktuellen State
 *     senden, damit der Client nicht auf den nächsten Poll warten muss.
 *   - Danach abonniert er sich beim Module-Singleton in `lib/state.ts`. Jeder
 *     Spotify-Poll oder jede Mutation feuert dort `emit()`, was hier landet.
 *   - Heartbeat alle 15 s als SSE-Comment (`:keepalive`), damit Proxies/iOS
 *     den Stream nicht wegen Inaktivität kappen.
 *   - Cleanup im `cancel`-Callback des Streams: unsubscribe + Heartbeat-Timer
 *     stoppen. Subscriber-Counter im State-Modul kümmert sich darum, das
 *     Polling-Interval zu stoppen, wenn der letzte Client geht.
 */

import { subscribe } from '@/lib/state';
import type { StateSnapshot } from '@/lib/server-state-types';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  let heartbeat: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (snapshot: StateSnapshot) => {
        try {
          controller.enqueue(encoder.encode(sse('snapshot', snapshot)));
        } catch {
          // Stream geschlossen — Cleanup läuft via `cancel`.
        }
      };

      const sub = subscribe(push);
      unsubscribe = sub.unsubscribe;

      // Initial-Snapshot direkt rauspushen.
      controller.enqueue(encoder.encode(sse('snapshot', sub.initialSnapshot)));

      // Keep-Alive für Proxies / iOS-Safari-Background-Quirks.
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
      'X-Accel-Buffering': 'no', // nginx, falls jemand das mal hinter einen Proxy hängt.
    },
  });
}
