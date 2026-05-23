'use client';

type Props = {
  onSkip: () => void;
  onDislike: () => void;
  onLove: () => void;
  toast: string | null;
};

export default function AntiButtons({ onSkip, onDislike, onLove, toast }: Props) {
  return (
    <>
      <div className="flex min-h-0 flex-1 gap-3 select-none">
        <button
          type="button"
          onClick={onSkip}
          style={{ touchAction: 'manipulation' }}
          className="flex h-full min-h-[4rem] md:min-h-[7.5rem] flex-1 cursor-pointer items-center justify-center gap-2 md:gap-4 rounded-2xl bg-zinc-800 px-3 md:px-6 text-base md:text-3xl font-semibold text-zinc-100 transition-all duration-300 ease-out hover:bg-red-900 hover:shadow-[0_0_18px_rgba(220,38,38,0.4)] active:scale-95"
        >
          <span aria-hidden className="text-2xl md:text-5xl">&#9197;</span>
          Skip Jetzt
        </button>
        <button
          type="button"
          onClick={onDislike}
          style={{ touchAction: 'manipulation' }}
          className="flex h-full min-h-[4rem] md:min-h-[7.5rem] flex-1 cursor-pointer items-center justify-center gap-2 md:gap-4 rounded-2xl bg-zinc-800 px-3 md:px-6 text-base md:text-3xl font-semibold text-zinc-100 transition-all duration-300 ease-out hover:bg-yellow-900 hover:shadow-[0_0_18px_rgba(202,138,4,0.4)] active:scale-95"
        >
          <span aria-hidden className="text-2xl md:text-5xl">&#128078;</span>
          Nicht das
        </button>
        <button
          type="button"
          onClick={onLove}
          style={{ touchAction: 'manipulation' }}
          className="flex h-full min-h-[4rem] md:min-h-[7.5rem] flex-1 cursor-pointer items-center justify-center gap-2 md:gap-4 rounded-2xl bg-zinc-800 px-3 md:px-6 text-base md:text-3xl font-semibold text-zinc-100 transition-all duration-300 ease-out hover:bg-pink-900 hover:shadow-[0_0_18px_rgba(219,39,119,0.4)] active:scale-95"
        >
          <span aria-hidden className="text-2xl md:text-5xl">&#10084;&#65039;</span>
          Mehr davon
        </button>
      </div>

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
