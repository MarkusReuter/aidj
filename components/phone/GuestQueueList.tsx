'use client';

import Image from 'next/image';

export type GuestQueueEntry = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  guestLabel: string;
  isMine: boolean;
};

type Props = {
  entries: GuestQueueEntry[];
};

export default function GuestQueueList({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 text-center text-sm text-zinc-500">
        Noch keine Gast-Wünsche in der Warteschlange.
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 select-none">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Gast-Queue (FIFO)
      </h3>
      <ol className="flex flex-col gap-2">
        {entries.map((entry, idx) => (
          <li
            key={entry.id}
            className={[
              'flex items-center gap-3 rounded-xl border p-2',
              entry.isMine
                ? 'border-purple-500/60 bg-purple-500/10 ring-1 ring-purple-500/40'
                : 'border-zinc-800 bg-zinc-900',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-mono font-bold',
                entry.isMine
                  ? 'bg-purple-500 text-white'
                  : 'bg-zinc-800 text-zinc-400',
              ].join(' ')}
            >
              {idx + 1}
            </span>
            <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg">
              <Image
                src={entry.coverUrl}
                alt=""
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-zinc-100">
                {entry.title}
              </span>
              <span className="truncate text-xs text-zinc-400">
                {entry.artist}
              </span>
            </div>
            <span className="flex-shrink-0 text-xs text-zinc-500">
              {entry.isMine ? '⭐ du' : entry.guestLabel}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
