'use client';

import { useMemo } from 'react';

type Props = {
  moodCounts: Record<string, number>;
};

const HEARTBEATS: { symbol: string; label: string; tone: string }[] = [
  { symbol: '🥱', label: 'müde Crowd', tone: 'bg-zinc-700/60 text-zinc-300' },
  { symbol: '👌', label: 'läuft entspannt', tone: 'bg-blue-500/20 text-blue-200' },
  { symbol: '🔥', label: 'Crowd ist heiß', tone: 'bg-orange-500/20 text-orange-200' },
  { symbol: '🚀', label: 'volle Eskalation', tone: 'bg-pink-500/20 text-pink-200' },
];

// Bucketing of the dominant mood signal:
// - sum of mood-clicks above 0 → pick the bucket whose key is most popular,
//   fall back to "läuft entspannt" if nothing has been clicked yet
//   (purely visual — Phase 5 will replace this with a real LLM-derived value).
function deriveHeartbeat(counts: Record<string, number>): typeof HEARTBEATS[number] {
  const entries = Object.entries(counts);
  if (entries.length === 0) return HEARTBEATS[1]!;
  const top = entries.reduce((max, cur) => (cur[1] > max[1] ? cur : max));
  if (top[0] === 'tired' || top[0] === 'slow' || top[0] === 'softer' || top[0] === 'chill') {
    return HEARTBEATS[0]!;
  }
  if (top[0] === 'hot' || top[0] === 'fast' || top[0] === 'bangers' || top[0] === 'harder') {
    return HEARTBEATS[2]!;
  }
  if (top[0] === 'peak' || top[0] === 'max' || top[0] === 'lateNight') {
    return HEARTBEATS[3]!;
  }
  return HEARTBEATS[1]!;
}

export default function HeartbeatBadge({ moodCounts }: Props) {
  const beat = useMemo(() => deriveHeartbeat(moodCounts), [moodCounts]);

  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-full ${beat.tone} px-4 py-2 text-sm font-semibold transition-colors`}
    >
      <span aria-hidden className="text-lg">
        {beat.symbol}
      </span>
      <span>{beat.label}</span>
    </div>
  );
}
