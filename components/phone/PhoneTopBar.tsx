'use client';

import { ReactNode } from 'react';

type Props = {
  isDj: boolean;
  onLogoTap: () => void;
  statusBadge?: ReactNode;
};

export default function PhoneTopBar({ isDj, onLogoTap, statusBadge }: Props) {
  return (
    <header className="flex flex-none items-center justify-between gap-3 px-4 py-3 select-none">
      <button
        type="button"
        onClick={onLogoTap}
        // No visible cue that this is the DJ-unlock zone — intentional. Tap target
        // stays generous (padding) so a fat finger still registers all 10 taps.
        className="-m-2 flex items-center gap-2 rounded-lg p-2 active:bg-zinc-800/60"
        aria-label="AIDJ"
      >
        <span className="text-2xl" aria-hidden>
          🎵
        </span>
        <span className="text-lg font-bold tracking-tight text-zinc-100">
          AIDJ
          {isDj && (
            <span className="ml-2 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-semibold text-purple-300">
              DJ
            </span>
          )}
        </span>
      </button>
      {statusBadge}
    </header>
  );
}
