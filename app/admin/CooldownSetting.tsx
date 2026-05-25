'use client';

/**
 * Track-Cooldown-Auswahl. Tracks, die innerhalb des Fensters liefen, werden
 * vom DJ-Brain für Picks gesperrt. Gast-Wünsche umgehen den Filter (Gast soll
 * sein Lied bekommen, auch wenn es gerade lief).
 */

import { useCallback, useEffect, useState } from 'react';

type Preset = { label: string; minutes: number };

const PRESETS: Preset[] = [
  { label: 'Aus', minutes: 0 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h', minutes: 240 },
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; minutes: number }
  | { kind: 'error'; message: string };

export default function CooldownSetting() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { cooldownMinutes: number };
        if (!cancelled) setState({ kind: 'ready', minutes: data.cooldownMinutes });
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
    async (minutes: number) => {
      if (state.kind !== 'ready' || state.minutes === minutes || saving) return;
      const prev = state.minutes;
      setState({ kind: 'ready', minutes }); // optimistisch
      setSaving(true);
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cooldownMinutes: minutes }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { cooldownMinutes: number };
        setState({ kind: 'ready', minutes: data.cooldownMinutes });
      } catch (err) {
        setState({ kind: 'ready', minutes: prev }); // rollback
        console.warn('[cooldown] save failed:', err);
      } finally {
        setSaving(false);
      }
    },
    [state, saving],
  );

  return (
    <section className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-200">Track-Cooldown</h2>
        <p className="text-xs text-zinc-500">
          Wie lange ein gespielter Track nicht erneut vorgeschlagen wird
        </p>
      </header>

      {state.kind === 'loading' && (
        <p className="text-xs text-zinc-500">Lade…</p>
      )}
      {state.kind === 'error' && (
        <p className="text-xs text-red-400">Fehler: {state.message}</p>
      )}
      {state.kind === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = p.minutes === state.minutes;
              return (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => choose(p.minutes)}
                  disabled={saving}
                  className={
                    active
                      ? 'rounded-md border border-violet-700 bg-violet-950/40 px-3 py-1.5 text-sm font-medium text-violet-200 shadow-inner'
                      : 'rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50'
                  }
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Brain-Picks ignorieren Tracks innerhalb dieses Fensters. Gast-Wünsche
            sind nicht betroffen. Bei sehr kleiner Library greift der Filter
            automatisch nicht, falls sonst keine Picks übrig blieben.
          </p>
        </>
      )}
    </section>
  );
}
