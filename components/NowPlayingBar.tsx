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

export default function NowPlayingBar({ track, progressMs }: Props) {
  // Demo-Loop: Tracks "enden" nach 5% der eigentlichen Dauer.
  // Progressbar fuellt sich relativ zu dieser Demo-Dauer aus, damit sie sichtbar laeuft.
  const demoDurationMs = track.durationMs * 0.05;
  const clampedProgress = Math.min(progressMs, demoDurationMs);
  const progressPct = demoDurationMs > 0 ? (clampedProgress / demoDurationMs) * 100 : 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 select-none">
      {/* Blurred background cover */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <Image
          src={track.coverUrl}
          alt=""
          width={600}
          height={600}
          aria-hidden
          className="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
        />
      </div>

      <div className="relative z-10 flex items-center gap-6">
        <Image
          src={track.coverUrl}
          alt={`${track.title} cover`}
          width={128}
          height={128}
          priority
          className="h-32 w-32 flex-shrink-0 rounded-xl object-cover shadow-lg"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-50">
              <span className="text-zinc-50">{track.title}</span>
              <span className="mx-2 text-zinc-600">&mdash;</span>
              <span className="text-zinc-400">{track.artist}</span>
            </h2>
            <span className="flex-shrink-0 rounded-full bg-zinc-800/80 px-3 py-1 text-sm font-mono font-semibold text-zinc-200">
              {track.genre}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-zinc-400 tabular-nums">
              {formatTime(clampedProgress)}
            </span>
            <div
              className="relative h-3 flex-1 overflow-hidden rounded-full bg-zinc-800"
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
            <span className="font-mono text-sm text-zinc-400 tabular-nums">
              {formatTime(demoDurationMs)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
