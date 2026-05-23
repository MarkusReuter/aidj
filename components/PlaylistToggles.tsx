'use client';

type Props = {
  playlists: string[];
  active: Set<string>;
  onToggle: (p: string) => void;
};

const BUTTON_CLASSES =
  'h-full min-h-[4rem] flex-1 basis-0 cursor-pointer rounded-2xl px-2 text-xl font-semibold transition-colors duration-200 active:scale-95';

export default function PlaylistToggles({ playlists, active, onToggle }: Props) {
  // Alle 9 Buttons in einer einzigen horizontalen Reihe, gleich breit via
  // `flex-1 basis-0`. Auf 1280 px Landscape ergibt das ~125 px pro Button.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 select-none">
      <span className="text-lg font-semibold tracking-wider text-zinc-500">
        PLAYLISTS
      </span>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 md:flex">
        {playlists.map((p) => {
          const isActive = active.has(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => onToggle(p)}
              style={{ touchAction: 'manipulation' }}
              className={[
                BUTTON_CLASSES,
                isActive
                  ? 'bg-purple-500 text-white shadow-[0_0_12px_rgba(168,85,247,0.5)]'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600',
              ].join(' ')}
              aria-pressed={isActive}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}
