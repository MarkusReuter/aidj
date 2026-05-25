/**
 * Wire-Format für SSE-Snapshots. Bewusst getrennt von `lib/state.ts`, damit
 * Client-Components die Types ziehen können, ohne dass node-only-Code
 * (EventEmitter, fs) in den Browser-Bundle reinläuft.
 */

import type { MoodOption } from './mock-data';

export type SnapshotTrack = {
  /** Spotify-URI (`spotify:track:…`) oder Mock-ID, wenn nichts läuft */
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  bpm: number;
  durationMs: number;
  genre: string;
};

export type SnapshotMoodQuestion = {
  id: string;
  question: string;
  options: MoodOption[];
};

export type SnapshotGuestEntry = {
  guestId: string;
  guestName: string;
  trackUri: string;
  trackMeta: {
    title: string;
    artist: string;
    coverUrl: string;
    durationMs: number;
  };
  submissionId: string;
  submittedAt: number;
  status: 'pending' | 'playing' | 'done';
};

/**
 * Status des letzten DJ-Brain-Calls. `null` solange noch kein Track-Wechsel
 * passiert ist. Update bei jedem Track-Wechsel — die Werte sind "frozen at
 * last pick", nicht live.
 */
export type SnapshotBrainStatus = {
  provider: 'google' | 'anthropic' | 'heuristic';
  /** Round-Trip-Zeit in ms beim letzten Call (0 bei Heuristik). */
  latencyMs: number;
  /** Wall-clock-Zeit des letzten Calls. */
  at: number;
};

export type StateSnapshot = {
  /** Wall-clock-Zeit der Snapshot-Erstellung (ms). Client interpoliert progressMs darüber. */
  snapshotAt: number;
  spotify:
    | { connected: false }
    | { connected: true; activeDeviceId: string | null; deviceName: string | null };
  currentTrack: SnapshotTrack | null;
  /** Wo der Track stand zum Zeitpunkt `snapshotAt`. Client zählt lokal hoch. */
  progressMs: number;
  isPlaying: boolean;
  candidates: SnapshotTrack[];
  committedId: string | null;
  currentMoodQuestion: SnapshotMoodQuestion | null;
  moodCounts: Record<string, number>;
  activePlaylists: string[];
  /** Aktive Gast-Wünsche (pending + playing), in Submission-Reihenfolge. */
  guestQueue: SnapshotGuestEntry[];
  /** Status des letzten DJ-Brain-Calls; null bis zum ersten Track-Wechsel. */
  brain: SnapshotBrainStatus | null;
};

export type ButtonEvent =
  | { type: 'mood'; value: string }
  | { type: 'playlist'; value: string }
  | { type: 'anti'; value: 'dislike' | 'love' };
