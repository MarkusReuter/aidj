'use client';

/**
 * Schalter, ob BPM überhaupt eine Rolle spielt: angezeigt (Kandidaten-Karten
 * auf Tablet/Phone) UND vom DJ-Brain beim Matchen berücksichtigt. Aus, wenn die
 * BPM-Daten unzuverlässig sind (GetSongBPM-Misses + LLM-Schätzungen) und mehr
 * stören als helfen. Schreibt `bpmEnabled` in die Host-Settings; der Server
 * spiegelt das beim nächsten Poll in den Party-State.
 */

import { useCallback, useEffect, useState } from 'react';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; enabled: boolean }
  | { kind: 'error'; message: string };

export default function BpmSetting() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { bpmEnabled: boolean };
        if (!cancelled) setState({ kind: 'ready', enabled: data.bpmEnabled });
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
    async (enabled: boolean) => {
      if (state.kind !== 'ready' || state.enabled === enabled || saving) return;
      const prev = state.enabled;
      setState({ kind: 'ready', enabled }); // optimistisch
      setSaving(true);
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bpmEnabled: enabled }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { bpmEnabled: boolean };
        setState({ kind: 'ready', enabled: data.bpmEnabled });
      } catch (err) {
        setState({ kind: 'ready', enabled: prev }); // rollback
        console.warn('[bpm-setting] save failed:', err);
      } finally {
        setSaving(false);
      }
    },
    [state, saving],
  );

  return (
    <section className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-200">BPM</h2>
        <p className="text-xs text-zinc-500">
          Auf Karten anzeigen + vom DJ-Brain berücksichtigen
        </p>
      </header>

      {state.kind === 'loading' && <p className="text-xs text-zinc-500">Lade…</p>}
      {state.kind === 'error' && (
        <p className="text-xs text-red-400">Fehler: {state.message}</p>
      )}
      {state.kind === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, label: 'An' },
              { value: false, label: 'Aus' },
            ].map((o) => {
              const active = o.value === state.enabled;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => choose(o.value)}
                  disabled={saving}
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
            BPM-Daten kommen aus GetSongBPM (Messwert) bzw. als LLM-Schätzung beim
            Auto-Tag. Sind sie lückenhaft oder unzuverlässig, hier ausschalten —
            dann ignoriert der Brain das Tempo und die Karten zeigen es nicht.
          </p>
        </>
      )}
    </section>
  );
}
