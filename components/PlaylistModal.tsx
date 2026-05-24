'use client';

import { useEffect } from 'react';

type Props = {
  playlists: string[];
  active: Set<string>;
  onToggle: (p: string) => void;
  open: boolean;
  onClose: () => void;
};

export default function PlaylistModal({
  playlists,
  active,
  onToggle,
  open,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Playlists wählen"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm animate-[fade-in_0.15s_ease-out] select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-5xl flex-col gap-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-bold text-zinc-50">Playlists wählen</h2>
          <span className="text-sm text-zinc-500">
            {active.size > 0 ? `${active.size} aktiv` : 'keine aktiv = alle erlaubt'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {playlists.map((p) => {
            const isActive = active.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => onToggle(p)}
                aria-pressed={isActive}
                style={{ touchAction: 'manipulation' }}
                className={[
                  'flex min-h-[7.5rem] cursor-pointer items-center justify-center rounded-2xl border-2 px-4 py-6 text-xl font-semibold transition-all duration-200 active:scale-95',
                  isActive
                    ? 'border-purple-400 bg-purple-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.55)]'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
                ].join(' ')}
              >
                {p}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{ touchAction: 'manipulation' }}
          className="mt-2 min-h-[5rem] cursor-pointer rounded-2xl bg-purple-600 px-6 text-2xl font-bold text-white shadow-[0_0_18px_rgba(168,85,247,0.45)] transition-all duration-200 hover:bg-purple-500 active:scale-[0.98]"
        >
          Fertig
        </button>
      </div>
    </div>
  );
}
