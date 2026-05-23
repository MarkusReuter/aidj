'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export type SearchResult = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  source: 'playlist' | 'spotify';
};

type Props = {
  searchFn: (query: string) => Promise<SearchResult[]>;
  onPick: (result: SearchResult) => void;
  disabled?: boolean;
  disabledHint?: string;
};

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;

export default function SearchAutocomplete({
  searchFn,
  onPick,
  disabled = false,
  disabledHint,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setPending(false);
      return;
    }
    setPending(true);
    const myReqId = ++reqIdRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const r = await searchFn(trimmed);
        if (reqIdRef.current !== myReqId) return; // stale
        setResults(r.slice(0, MAX_RESULTS));
      } catch {
        if (reqIdRef.current !== myReqId) return;
        setResults([]);
      } finally {
        if (reqIdRef.current === myReqId) setPending(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, searchFn]);

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Oder suche einen Track
      </h3>

      <div className="relative">
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="🔍 Track oder Künstler suchen…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          className="w-full select-text rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-500 disabled:opacity-50"
          style={{ WebkitUserSelect: 'text', userSelect: 'text', fontSize: '16px' }}
        />
      </div>

      {disabled && disabledHint && (
        <p className="text-xs text-zinc-500">{disabledHint}</p>
      )}

      {!disabled && results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((r) => {
            const isPicked = selected?.id === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  style={{ touchAction: 'manipulation' }}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                    isPicked
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-zinc-800 bg-zinc-900 active:bg-zinc-800',
                  ].join(' ')}
                >
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded">
                    <Image
                      src={r.coverUrl}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-zinc-100">
                      {r.title}
                    </span>
                    <span className="truncate text-xs text-zinc-400">
                      {r.artist}
                    </span>
                  </div>
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
                      r.source === 'playlist'
                        ? 'bg-purple-500/20 text-purple-300'
                        : 'bg-zinc-800 text-zinc-400',
                    ].join(' ')}
                  >
                    {r.source === 'playlist' ? 'Playlist' : 'Spotify'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && query.trim().length > 0 && results.length === 0 && !pending && (
        <p className="text-xs text-zinc-500">Keine Treffer für "{query}".</p>
      )}

      {selected && !disabled && (
        <button
          type="button"
          onClick={() => {
            onPick(selected);
            setQuery('');
            setResults([]);
            setSelected(null);
          }}
          style={{ touchAction: 'manipulation' }}
          className="rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-3 text-base font-bold text-white shadow-lg active:scale-[0.98]"
        >
          ▶ "{selected.title}" wählen
        </button>
      )}
    </section>
  );
}
