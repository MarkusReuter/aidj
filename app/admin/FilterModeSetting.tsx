'use client';

/**
 * Toggle für den Filter-Modus des Tablet-/Phone-"Filter"-Buttons: zeigt der
 * Button die Quell-Playlists der Library oder ihre Genres an (und filtert die
 * Brain-Picks entsprechend). Schreibt `antiFilterMode` in die Host-Settings;
 * der Server leert beim Wechsel die aktiven Filter und pusht ein SSE-Update.
 */

import { useCallback, useEffect, useState } from 'react';

type Mode = 'playlists' | 'genres';

const OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: 'playlists', label: 'Playlists', hint: 'Quell-Playlists aus dem Import' },
  { value: 'genres', label: 'Genres', hint: 'Genres aus der Library' },
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; mode: Mode }
  | { kind: 'error'; message: string };

export default function FilterModeSetting() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { antiFilterMode: Mode };
        if (!cancelled) setState({ kind: 'ready', mode: data.antiFilterMode });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback(
    async (mode: Mode) => {
      if (state.kind !== 'ready' || state.mode === mode || saving) return;
      const prev = state.mode;
      setState({ kind: 'ready', mode }); // optimistisch
      setSaving(true);
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ antiFilterMode: mode }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { antiFilterMode: Mode };
        setState({ kind: 'ready', mode: data.antiFilterMode });
      } catch (err) {
        setState({ kind: 'ready', mode: prev }); // rollback
        console.warn('[filter-mode] save failed:', err);
      } finally {
        setSaving(false);
      }
    },
    [state, saving],
  );

  return (
    <section className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-200">Filter-Button</h2>
        <p className="text-xs text-zinc-500">
          Was der „Playlists/Genres"-Button auf dem Tablet zeigt
        </p>
      </header>

      {state.kind === 'loading' && <p className="text-xs text-zinc-500">Lade…</p>}
      {state.kind === 'error' && (
        <p className="text-xs text-red-400">Fehler: {state.message}</p>
      )}
      {state.kind === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            {OPTIONS.map((o) => {
              const active = o.value === state.mode;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => choose(o.value)}
                  disabled={saving}
                  title={o.hint}
                  className={
                    active
                      ? 'rounded-md border border-violet-700 bg-violet-950/40 px-3 py-1.5 text-sm font-medium text-violet-200 shadow-inner'
                      : 'rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50'
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Die Auswahl-Liste leitet sich automatisch aus der Library ab
            (Playlists aus dem Import bzw. vergebene Genres). Beim Umschalten
            werden die aktiven Filter geleert.
          </p>
        </>
      )}
    </section>
  );
}
