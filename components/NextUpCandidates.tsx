'use client';

import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import type { Track } from '@/lib/mock-data';
import type { FilterNotice } from '@/lib/server-state-types';

type Props = {
  candidates: Track[];
  committedId: string | null;
  autoPickInSec: number;
  onTap: (id: string) => void;
  /** Plan2: Long-Press auf Gast-Wunsch-Karte → Confirm-Modal → entfernen. */
  onRemoveWish?: (submissionId: string) => Promise<{ ok: boolean }>;
  /** BPM-Badge anzeigen (Host-Setting). Default true. */
  showBpm?: boolean;
  /** Gesetzt, wenn der aktive Filter zu wenige Tracks hatte (aufgefüllt). */
  filterNotice?: FilterNotice | null;
};

/** Sekunden → "m:ss" (z. B. 103 → "1:43"). */
function fmtCountdown(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Wie lange muss der Finger auf einer Wunsch-Karte liegen für die Lösch-Geste? */
const LONG_PRESS_MS = 700;

export default function NextUpCandidates({
  candidates,
  committedId,
  autoPickInSec,
  onTap,
  onRemoveWish,
  showBpm = true,
  filterNotice = null,
}: Props) {
  const [pending, setPending] = useState<{
    submissionId: string;
    track: Track;
  } | null>(null);
  const [removing, setRemoving] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressNextTapRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (track: Track) => {
      // Nur Gast-Wunsch-Karten sind löschbar.
      if (track.source !== 'guest' || !track.submissionId || !onRemoveWish) {
        return;
      }
      clearLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        suppressNextTapRef.current = true;
        setPending({ submissionId: track.submissionId!, track });
        longPressTimerRef.current = null;
      }, LONG_PRESS_MS);
    },
    [clearLongPress, onRemoveWish],
  );

  const handleTap = useCallback(
    (id: string) => {
      if (suppressNextTapRef.current) {
        // Long-Press hat gefeuert — der direkt folgende click-Event wird ignoriert.
        suppressNextTapRef.current = false;
        return;
      }
      onTap(id);
    },
    [onTap],
  );

  const handleConfirm = useCallback(async () => {
    if (!pending || !onRemoveWish) return;
    setRemoving(true);
    try {
      await onRemoveWish(pending.submissionId);
    } finally {
      setRemoving(false);
      setPending(null);
    }
  }, [pending, onRemoveWish]);

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 select-none">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
            NEXT UP &mdash; tippe einen Track:
          </h3>
          <p className="text-xs text-zinc-500">
            <span aria-hidden>&#9201;</span>{' '}
            Auto-Pick in {fmtCountdown(autoPickInSec)}, falls niemand tippt
          </p>
        </div>

        {filterNotice && (
          <p className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            {filterNotice.matched === 0
              ? `Kein Track mit Filter „${filterNotice.label}" in der Library — zeige gemischte Vorschläge.`
              : `Nur ${filterNotice.matched} Track${filterNotice.matched === 1 ? '' : 's'} mit Filter „${filterNotice.label}" — restliche Karten vom DJ ergänzt.`}
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 portrait:grid-cols-2">
          {candidates.map((track) => {
            const isCommitted = committedId === track.id;
            const isDimmed = committedId !== null && committedId !== track.id;
            const isGuest = track.source === 'guest';

            return (
              <button
                key={track.id}
                type="button"
                onClick={() => handleTap(track.id)}
                onPointerDown={() => startLongPress(track)}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={(e) => e.preventDefault()}
                className={[
                  'group relative flex h-full min-h-[11.25rem] cursor-pointer flex-col gap-2 overflow-hidden rounded-2xl border bg-zinc-900 p-3 text-left transition-all duration-300 ease-out select-none touch-manipulation',
                  'active:scale-[0.98]',
                  isGuest ? 'border-purple-700/60' : 'border-zinc-800',
                  isCommitted ? 'ring-4 ring-green-400 shadow-[0_0_24px_rgba(74,222,128,0.4)]' : '',
                  isDimmed ? 'opacity-40' : 'opacity-100',
                ].join(' ')}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-xl">
                  <Image
                    src={track.coverUrl}
                    alt={`${track.title} cover`}
                    fill
                    sizes="(max-width: 1280px) 25vw, 640px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {isCommitted && (
                    <div className="absolute top-2 left-2 rounded-full bg-green-500 px-2 py-0.5 text-xs font-bold text-zinc-900">
                      GEPICKT
                    </div>
                  )}
                  {showBpm && (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-mono font-semibold text-purple-300 backdrop-blur-sm animate-pulse">
                      <span aria-hidden>&#9834;</span>
                      {track.bpm}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-lg leading-tight font-bold text-zinc-50">
                    {track.title}
                  </p>
                  <p className="truncate text-sm text-zinc-400">{track.artist}</p>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2">
                  {isGuest ? (
                    <span
                      className="truncate rounded-full bg-purple-900/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-200"
                      title={track.guestName ? `Wunsch von ${track.guestName}` : 'Gast-Wunsch'}
                    >
                      👤 {track.guestName ?? 'Gast'}
                    </span>
                  ) : (
                    <span className="truncate rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                      🤖 LLM
                    </span>
                  )}
                  {track.genre && (
                    <span className="truncate rounded-full bg-zinc-800/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                      {track.genre}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => !removing && setPending(null)}
        >
          <div
            className="max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">Track aus Wunschliste entfernen?</h2>
            <p className="mt-2 text-sm text-zinc-400">
              <strong className="text-zinc-200">{pending.track.title}</strong> —{' '}
              {pending.track.artist}
              {pending.track.guestName && (
                <>
                  <br />
                  Wunsch von {pending.track.guestName}
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={removing}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={removing}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {removing ? 'Entferne…' : 'Löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
