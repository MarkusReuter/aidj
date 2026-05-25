'use client';

import Image from 'next/image';
import type { Track } from '@/lib/mock-data';

type Props = {
  track: Track;
  progressMs: number;
};

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingCard({ track, progressMs }: Props) {
  const clampedProgress = Math.min(progressMs, track.durationMs);
  const progressPct =
    track.durationMs > 0 ? (clampedProgress / track.durationMs) * 100 : 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 select-none">
      <div className="pointer-events-none absolute inset-0 -z-0">
        <Image
          src={track.coverUrl}
          alt=""
          width={600}
          height={600}
          priority
          aria-hidden
          className="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3">
        <Image
          src={track.coverUrl}
          alt={`${track.title} cover`}
          width={240}
          height={240}
          priority
          className="h-60 w-60 flex-shrink-0 rounded-2xl object-cover shadow-2xl"
        />
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="text-xl font-bold leading-tight text-zinc-50">
            {track.title}
          </h2>
          <p className="text-sm text-zinc-400">{track.artist}</p>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="font-mono text-xs text-zinc-500 tabular-nums">
            {formatTime(clampedProgress)}
          </span>
          <div
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width] duration-100 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-xs text-zinc-500 tabular-nums">
            {formatTime(track.durationMs)}
          </span>
        </div>
      </div>
    </section>
  );
}
