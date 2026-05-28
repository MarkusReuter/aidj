'use client';

type Props = {
  onSkip: () => void;
  onDislike: () => void;
  onLove: () => void;
  onOpenPlaylists: () => void;
  activePlaylistCount: number;
  /** Steuert das Button-Label: "Playlists" oder "Genres". */
  filterMode: 'playlists' | 'genres';
  toast: string | null;
};

const BUTTON_BASE =
  'flex h-full min-h-[4rem] md:min-h-[5rem] flex-1 cursor-pointer items-center justify-center gap-2 md:gap-3 rounded-2xl bg-zinc-800 px-3 md:px-4 text-base md:text-lg font-semibold text-zinc-100 transition-all duration-300 ease-out active:scale-95';

export default function AntiButtons({
  onSkip,
  onDislike,
  onLove,
  onOpenPlaylists,
  activePlaylistCount,
  filterMode,
  toast,
}: Props) {
  return (
    <>
      <section className="flex flex-none flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 select-none">
        <div className="grid grid-cols-2 gap-3 select-none md:flex md:flex-none">
        <button
          type="button"
          onClick={onSkip}
          style={{ touchAction: 'manipulation' }}
          className={`${BUTTON_BASE} hover:bg-red-900 hover:shadow-[0_0_18px_rgba(220,38,38,0.4)]`}
        >
          <span aria-hidden className="text-2xl md:text-3xl">&#9197;</span>
          Skip Jetzt
        </button>
        <button
          type="button"
          onClick={onDislike}
          style={{ touchAction: 'manipulation' }}
          className={`${BUTTON_BASE} hover:bg-yellow-900 hover:shadow-[0_0_18px_rgba(202,138,4,0.4)]`}
        >
          <span aria-hidden className="text-2xl md:text-3xl">&#128078;</span>
          Nicht das
        </button>
        <button
          type="button"
          onClick={onLove}
          style={{ touchAction: 'manipulation' }}
          className={`${BUTTON_BASE} hover:bg-pink-900 hover:shadow-[0_0_18px_rgba(219,39,119,0.4)]`}
        >
          <span aria-hidden className="text-2xl md:text-3xl">&#10084;&#65039;</span>
          Mehr davon
        </button>
        <button
          type="button"
          onClick={onOpenPlaylists}
          style={{ touchAction: 'manipulation' }}
          className={`${BUTTON_BASE} relative hover:bg-purple-900 hover:shadow-[0_0_18px_rgba(168,85,247,0.45)]`}
        >
          <span aria-hidden className="text-2xl md:text-3xl">&#127911;</span>
          {filterMode === 'genres' ? 'Genres' : 'Playlists'}
          {activePlaylistCount > 0 && (
            <span className="absolute top-2 right-2 rounded-full bg-purple-500 px-2 py-0.5 text-xs font-bold text-white">
              {activePlaylistCount}
            </span>
          )}
        </button>
        </div>
      </section>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/95 px-6 py-3 text-base font-medium text-zinc-100 shadow-2xl backdrop-blur animate-[fade-in_0.2s_ease-out]"
        >
          {toast}
        </div>
      )}
    </>
  );
}
