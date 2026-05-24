'use client';

import Image from 'next/image';
import type { Track } from '@/lib/mock-data';

type Props = {
  candidates: Track[];
  committedId: string | null;
  autoPickInSec: number;
  onTap: (id: string) => void;
};

export default function NextUpCandidates({
  candidates,
  committedId,
  autoPickInSec,
  onTap,
}: Props) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 select-none">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
          NEXT UP &mdash; tippe einen Track:
        </h3>
        <p className="text-xs text-zinc-500">
          <span aria-hidden>&#9201;</span>{' '}
          Auto-Pick in 0:{autoPickInSec.toString().padStart(2, '0')}, falls niemand tippt
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 portrait:grid-cols-2">
        {candidates.map((track) => {
          const isCommitted = committedId === track.id;
          const isDimmed = committedId !== null && committedId !== track.id;

          return (
            <button
              key={track.id}
              type="button"
              onClick={() => onTap(track.id)}
              style={{ touchAction: 'manipulation' }}
              className={[
                'group relative flex h-full min-h-[11.25rem] cursor-pointer flex-col gap-2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left transition-all duration-300 ease-out select-none',
                'active:scale-[0.98]',
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
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-mono font-semibold text-purple-300 backdrop-blur-sm animate-pulse">
                  <span aria-hidden>&#9834;</span>
                  {track.bpm}
                </span>
              </div>

              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-lg leading-tight font-bold text-zinc-50">
                  {track.title}
                </p>
                <p className="truncate text-sm text-zinc-400">{track.artist}</p>
              </div>

              <div className="mt-auto flex items-center">
                <span className="truncate rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                  {track.genre}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
