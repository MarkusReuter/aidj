'use client';

import Image from 'next/image';
import type { Track } from '@/lib/mock-data';

type Props = {
  candidates: Track[];
  committedId: string | null;
  autoPickInSec: number;
  onTap: (id: string) => void;
  /** BPM-Badge anzeigen (Host-Setting). Default true. */
  showBpm?: boolean;
};

/** Sekunden → "m:ss" (z. B. 103 → "1:43"). */
function fmtCountdown(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PhoneCandidates({
  candidates,
  committedId,
  autoPickInSec,
  onTap,
  showBpm = true,
}: Props) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 select-none">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Wähle den nächsten Track
      </h3>

      <ul className="flex flex-col gap-2">
        {candidates.map((track) => {
          const isCommitted = committedId === track.id;
          const isDimmed = committedId !== null && committedId !== track.id;

          return (
            <li key={track.id}>
              <button
                type="button"
                onClick={() => onTap(track.id)}
                style={{ touchAction: 'manipulation' }}
                className={[
                  'flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-left transition-all duration-200 ease-out select-none',
                  'active:scale-[0.99]',
                  isCommitted
                    ? 'ring-2 ring-green-400 shadow-[0_0_12px_rgba(74,222,128,0.35)]'
                    : '',
                  isDimmed ? 'opacity-40' : 'opacity-100',
                ].join(' ')}
              >
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
                  <Image
                    src={track.coverUrl}
                    alt={`${track.title} cover`}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                  {isCommitted && (
                    <div className="absolute inset-x-0 bottom-0 bg-green-500 py-0.5 text-center text-[10px] font-bold uppercase text-zinc-900">
                      Gepickt
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate text-base font-semibold leading-tight text-zinc-50">
                    {track.title}
                  </p>
                  <p className="truncate text-sm text-zinc-400">{track.artist}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {showBpm && (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-mono font-semibold text-purple-300">
                        ♪ {track.bpm}
                      </span>
                    )}
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                      {track.genre}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-center text-xs text-zinc-500">
        Auto-Pick in {fmtCountdown(autoPickInSec)}, falls niemand tippt
      </p>
    </section>
  );
}
