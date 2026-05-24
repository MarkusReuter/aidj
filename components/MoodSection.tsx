'use client';

import type { MoodQuestion } from '@/lib/mock-data';

type Props = {
  question: MoodQuestion;
  counts: Record<string, number>;
  onPress: (value: string) => void;
};

export default function MoodSection({ question, counts, onPress }: Props) {
  return (
    <section className="flex flex-none flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 select-none">
      <h3 className="text-lg font-semibold text-zinc-100">
        <span aria-hidden className="mr-2">&#10067;</span>
        {question.question}
      </h3>

      <div className="grid grid-cols-2 gap-3 md:flex">
        {question.options.map((opt) => {
          const count = counts[opt.value] ?? 0;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPress(opt.value)}
              style={{ touchAction: 'manipulation' }}
              className="relative flex h-full min-h-[6.75rem] flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-800 px-3 py-2 text-zinc-100 transition-all duration-300 ease-out select-none hover:bg-zinc-700 hover:shadow-[0_0_18px_rgba(168,85,247,0.45)] active:scale-95 active:bg-purple-700"
            >
              <span className="text-3xl leading-none" aria-hidden>
                {opt.emoji}
              </span>
              <span className="text-sm font-semibold">{opt.label}</span>
              {count > 0 && (
                <span className="absolute top-2 right-2 rounded-full bg-purple-500 px-2 py-0.5 text-xs font-bold text-white">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
