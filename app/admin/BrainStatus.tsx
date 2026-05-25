'use client';

/**
 * Live-Badge im Admin-UI: zeigt, welcher Provider den letzten Track-Pick
 * gemacht hat (Gemini / Claude / Heuristik) + Latenz + Alter des Picks.
 *
 * Subscribed direkt auf den SSE-Stream (eigene EventSource statt
 * `useServerState`, weil wir hier weder Tap-Handler noch Progress-rAF
 * brauchen — nur das `brain`-Feld aus dem Snapshot).
 *
 * Vor dem ersten Track-Wechsel ist `brain` null; dann zeigt der Badge
 * "noch kein Pick gemacht" als sanften Hinweis.
 */

import { useEffect, useState } from 'react';
import type { SnapshotBrainStatus, StateSnapshot } from '@/lib/server-state-types';

const PROVIDER_LABEL: Record<SnapshotBrainStatus['provider'], string> = {
  google: '🧠 Gemini 2.5 Flash',
  anthropic: '🧠 Claude Sonnet 4.6',
  heuristic: '⚙ Heuristik (kein LLM-Key)',
};

const PROVIDER_STYLE: Record<SnapshotBrainStatus['provider'], string> = {
  google: 'border-sky-900/50 bg-sky-950/30 text-sky-300',
  anthropic: 'border-violet-900/50 bg-violet-950/30 text-violet-300',
  heuristic: 'border-zinc-800 bg-zinc-900/40 text-zinc-400',
};

function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `vor ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  return `vor ${h} h`;
}

export default function BrainStatus() {
  const [brain, setBrain] = useState<SnapshotBrainStatus | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/state/stream');
    es.addEventListener('snapshot', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as StateSnapshot;
        setBrain(data.brain);
      } catch {
        // Ignoriert — bei Parse-Fehler bleibt der letzte Stand stehen.
      }
    });
    return () => es.close();
  }, []);

  // Alter alle 5 s neu rendern, damit "vor 12s" nicht stehen bleibt.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  if (!brain) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-sm text-zinc-500">
        <span>🧠 DJ-Brain: noch kein Pick gemacht (wartet auf Track-Wechsel)</span>
      </div>
    );
  }

  const ageMs = Date.now() - brain.at;
  const label = PROVIDER_LABEL[brain.provider];
  const style = PROVIDER_STYLE[brain.provider];
  const latencyText =
    brain.provider === 'heuristic' ? '<1ms' : `${brain.latencyMs}ms`;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-2 text-sm ${style}`}
    >
      <div className="flex items-center gap-3">
        <span className="font-medium">{label}</span>
        <span className="text-xs opacity-70">letzter Pick: {latencyText}</span>
      </div>
      <span className="text-xs opacity-60">{formatAge(ageMs)}</span>
    </div>
  );
}
