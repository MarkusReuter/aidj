/**
 * Gast-Queue (Server-Only, In-Memory).
 *
 * FIFO-Queue der Track-Wünsche von Phone-Gästen. Regeln aus PLAN.md
 * (Phase 4a):
 *
 *   - **1 aktiver Slot pro Gast**: solange ein eigener Track in `pending`
 *     oder `playing` ist, lehnt enqueue() weitere Submissions desselben
 *     guestId mit `quota_exceeded` ab.
 *   - **Idempotenz**: gleiche `submissionId` innerhalb 30 s → vorhandener
 *     Entry wird zurückgegeben (Schutz vor Netzwerk-Retry / Doppel-Tap).
 *   - **Maximale Queue-Länge**: 10 pending-Entries gleichzeitig
 *     (Anti-Trolling-Limit aus PLAN.md, finale Zahl noch offen).
 *   - **Atomare Writes**: alle Mutationen laufen durch einen Promise-Chain-
 *     Mutex, damit zwei Phones, die gleichzeitig dieselbe Karte tippen,
 *     deterministisch serialisiert werden.
 *
 * Lifecycle-Trigger ruft `lib/state.ts` beim Spotify-Track-Wechsel auf:
 *   - `markPlaying(uri)` wenn der neue Now-Playing-Track ein pending-
 *     Gast-Wunsch ist.
 *   - `markDone(uri)` wenn der vorherige Now-Playing-Track ein
 *     playing/pending-Gast-Wunsch war.
 *
 * Persistenz: keine. Wie der Rest des Server-States lebt das nur im Node-
 * Prozess. `next start` während der Party, nicht `next dev`.
 */

export type GuestStatus = 'pending' | 'playing' | 'done';

export type GuestEntry = {
  guestId: string;
  guestName: string;
  trackUri: string;
  trackMeta: {
    title: string;
    artist: string;
    coverUrl: string;
    durationMs: number;
  };
  submissionId: string;
  submittedAt: number;
  status: GuestStatus;
};

export type EnqueueResult =
  | { ok: true; entry: GuestEntry; position: number; deduped: boolean }
  | { ok: false; error: 'quota_exceeded'; current: GuestEntry }
  | { ok: false; error: 'queue_full' };

const IDEMPOTENCY_TTL_MS = 30_000;
const MAX_PENDING = 10;

let entries: GuestEntry[] = [];
let mutex: Promise<unknown> = Promise.resolve();

function withMutex<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = mutex.then(fn, fn);
  // Errors in `fn` dürfen die Chain nicht killen — fangen wir hier ab.
  mutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function findActive(guestId: string): GuestEntry | undefined {
  return entries.find(
    (e) => e.guestId === guestId && e.status !== 'done',
  );
}

function countPending(): number {
  return entries.filter((e) => e.status === 'pending').length;
}

export async function enqueue(input: {
  guestId: string;
  guestName: string;
  trackUri: string;
  trackMeta: GuestEntry['trackMeta'];
  submissionId: string;
}): Promise<EnqueueResult> {
  return withMutex(() => {
    const now = Date.now();
    // Idempotency — gleicher Request kommt nochmal (Netzwerk-Retry).
    const existing = entries.find((e) => e.submissionId === input.submissionId);
    if (existing && now - existing.submittedAt < IDEMPOTENCY_TTL_MS) {
      const position = entries
        .filter((e) => e.status === 'pending')
        .findIndex((e) => e.submissionId === existing.submissionId);
      return {
        ok: true as const,
        entry: existing,
        position: position >= 0 ? position + 1 : 0,
        deduped: true,
      };
    }
    const conflicting = findActive(input.guestId);
    if (conflicting) {
      return { ok: false as const, error: 'quota_exceeded', current: conflicting };
    }
    if (countPending() >= MAX_PENDING) {
      return { ok: false as const, error: 'queue_full' };
    }
    const entry: GuestEntry = {
      guestId: input.guestId,
      guestName: input.guestName,
      trackUri: input.trackUri,
      trackMeta: input.trackMeta,
      submissionId: input.submissionId,
      submittedAt: now,
      status: 'pending',
    };
    entries.push(entry);
    const position = entries
      .filter((e) => e.status === 'pending')
      .findIndex((e) => e.submissionId === entry.submissionId);
    return {
      ok: true as const,
      entry,
      position: position >= 0 ? position + 1 : 0,
      deduped: false,
    };
  });
}

/**
 * Rollback nach Spotify-Fehler. Entfernt den Entry vollständig (nicht nur
 * status=done), damit der Gast direkt neu submitten kann ohne Quota-Lock.
 */
export async function rollback(submissionId: string): Promise<void> {
  await withMutex(() => {
    entries = entries.filter((e) => e.submissionId !== submissionId);
  });
}

export function peekNext(): GuestEntry | null {
  const pending = entries.find((e) => e.status === 'pending');
  return pending ?? null;
}

/**
 * Markiert den ersten pending-Entry mit passender URI als `playing`.
 * Wenn keiner gefunden wird (z.B. Host hat manuell in Spotify gestartet)
 * → no-op.
 */
export function markPlaying(trackUri: string): void {
  const entry = entries.find(
    (e) => e.trackUri === trackUri && e.status === 'pending',
  );
  if (entry) entry.status = 'playing';
}

/**
 * Markiert den ersten playing-Entry mit passender URI als `done`. Falls
 * der Track gespielt wurde, ohne dass wir den `playing`-Wechsel mitbekommen
 * haben (sehr schnelles Skipping), fangen wir auch noch einen pending-
 * Entry mit derselben URI ab.
 */
export function markDone(trackUri: string): void {
  const entry =
    entries.find((e) => e.trackUri === trackUri && e.status === 'playing') ??
    entries.find((e) => e.trackUri === trackUri && e.status === 'pending');
  if (entry) entry.status = 'done';
}

/** Aktive Entries (alles außer `done`), in Submission-Reihenfolge. */
export function listActive(): GuestEntry[] {
  return entries.filter((e) => e.status !== 'done');
}

/** Nur für Tests / Debug — kompletter Snapshot inkl. done-Entries. */
export function listAll(): readonly GuestEntry[] {
  return entries;
}

/** Für Tests. */
export function reset(): void {
  entries = [];
  mutex = Promise.resolve();
}
