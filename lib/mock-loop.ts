'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MOCK_TRACKS,
  MOCK_MOOD_QUESTIONS,
  type Track,
  type MoodQuestion,
} from '@/lib/mock-data';

export const MOCK_LOOP_TICK_MS = 100;
export const MOCK_LOOP_DEMO_DURATION_FACTOR = 0.05;
export const MOCK_LOOP_CANDIDATE_COUNT = 4;
export const MOCK_LOOP_TRACKS_PER_MOOD_QUESTION = 4;
export const MOCK_LOOP_TOAST_MS = 1500;

function pickCandidates(
  pool: readonly Track[],
  excludeId: string,
  count: number,
): Track[] {
  const filtered = pool.filter((t) => t.id !== excludeId);
  const shuffled = [...filtered];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a && b) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function initialCandidates(
  pool: readonly Track[],
  excludeId: string,
  count: number,
): Track[] {
  return pool.filter((t) => t.id !== excludeId).slice(0, count);
}

export type MockLoopState = {
  currentTrack: Track | undefined;
  candidates: Track[];
  committedId: string | null;
  progressMs: number;
  moodCounts: Record<string, number>;
  activePlaylists: Set<string>;
  currentQuestion: MoodQuestion | undefined;
  autoPickInSec: number;
  toast: string | null;
};

export type MockLoopHandlers = {
  onCandidateTap: (id: string) => void;
  onMoodPress: (value: string) => void;
  onPlaylistToggle: (p: string) => void;
  onSkip: () => void;
  onDislike: () => void;
  onLove: () => void;
};

export type UseMockLoopResult = MockLoopState & MockLoopHandlers;

/**
 * Shared mock game-loop used by both /tablet and /phone.
 *
 * Owns: current track index, candidate list, committed pick, progress timer,
 * mood-question rotation, mood counts, playlist toggles, anti-button toast.
 *
 * Track "ends" at DEMO_DURATION_FACTOR (5%) of its duration for a fast demo.
 * State is local to the hook instance — Tablet and Phone do NOT share state
 * across devices in this phase; that comes with SSE in Phase 4.
 */
export function useMockLoop(): UseMockLoopResult {
  const [currentTrackIdx, setCurrentTrackIdx] = useState(0);
  const [candidates, setCandidates] = useState<Track[]>(() =>
    MOCK_TRACKS.length > 0 && MOCK_TRACKS[0]
      ? initialCandidates(MOCK_TRACKS, MOCK_TRACKS[0].id, MOCK_LOOP_CANDIDATE_COUNT)
      : [],
  );
  const [committedId, setCommittedId] = useState<string | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [moodCounts, setMoodCounts] = useState<Record<string, number>>({});
  const [activePlaylists, setActivePlaylists] = useState<Set<string>>(() => new Set());
  const [moodQuestionIdx, setMoodQuestionIdx] = useState(0);
  const [tracksUntilMoodSwitch, setTracksUntilMoodSwitch] = useState(
    MOCK_LOOP_TRACKS_PER_MOOD_QUESTION,
  );
  const [toast, setToast] = useState<string | null>(null);

  const currentTrack: Track | undefined = MOCK_TRACKS[currentTrackIdx];
  const currentQuestion =
    MOCK_MOOD_QUESTIONS[moodQuestionIdx % Math.max(1, MOCK_MOOD_QUESTIONS.length)];

  const stateRef = useRef({
    currentTrackIdx,
    candidates,
    committedId,
    progressMs,
    tracksUntilMoodSwitch,
  });
  useEffect(() => {
    stateRef.current = {
      currentTrackIdx,
      candidates,
      committedId,
      progressMs,
      tracksUntilMoodSwitch,
    };
  }, [currentTrackIdx, candidates, committedId, progressMs, tracksUntilMoodSwitch]);

  useEffect(() => {
    const first = MOCK_TRACKS[0];
    if (!first) return;
    setCandidates(pickCandidates(MOCK_TRACKS, first.id, MOCK_LOOP_CANDIDATE_COUNT));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), MOCK_LOOP_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (MOCK_TRACKS.length === 0) return;

    const interval = window.setInterval(() => {
      const s = stateRef.current;
      const track = MOCK_TRACKS[s.currentTrackIdx];
      if (!track) return;
      const demoEnd = track.durationMs * MOCK_LOOP_DEMO_DURATION_FACTOR;
      const nextProgress = s.progressMs + MOCK_LOOP_TICK_MS;

      if (nextProgress >= demoEnd) {
        let nextTrack: Track | undefined;
        if (s.committedId) {
          nextTrack = MOCK_TRACKS.find((t) => t.id === s.committedId);
        }
        if (!nextTrack && s.candidates[0]) {
          nextTrack = s.candidates[0];
        }
        if (!nextTrack) {
          nextTrack =
            MOCK_TRACKS.find((t) => t.id !== track.id) ?? MOCK_TRACKS[0];
        }
        if (!nextTrack) return;

        const nextIdx = MOCK_TRACKS.findIndex((t) => t.id === nextTrack!.id);
        const newCandidates = pickCandidates(
          MOCK_TRACKS,
          nextTrack.id,
          MOCK_LOOP_CANDIDATE_COUNT,
        );

        setCurrentTrackIdx(nextIdx >= 0 ? nextIdx : 0);
        setCandidates(newCandidates);
        setCommittedId(null);
        setProgressMs(0);

        const remaining = s.tracksUntilMoodSwitch - 1;
        if (remaining <= 0) {
          setMoodQuestionIdx((prev) => prev + 1);
          setMoodCounts({});
          setTracksUntilMoodSwitch(MOCK_LOOP_TRACKS_PER_MOOD_QUESTION);
        } else {
          setTracksUntilMoodSwitch(remaining);
        }
      } else {
        setProgressMs(nextProgress);
      }
    }, MOCK_LOOP_TICK_MS);

    return () => window.clearInterval(interval);
  }, []);

  const onCandidateTap = useCallback((id: string) => {
    setCommittedId(id);
  }, []);

  const onMoodPress = useCallback((value: string) => {
    setMoodCounts((prev) => ({ ...prev, [value]: (prev[value] ?? 0) + 1 }));
  }, []);

  const onPlaylistToggle = useCallback((p: string) => {
    setActivePlaylists((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const onSkip = useCallback(() => {
    if (!currentTrack) return;
    setProgressMs(currentTrack.durationMs * MOCK_LOOP_DEMO_DURATION_FACTOR);
    setToast('⏭ Skip wird ausgefuehrt...');
  }, [currentTrack]);

  const onDislike = useCallback(() => {
    setToast('👎 Nicht das gemerkt');
  }, []);

  const onLove = useCallback(() => {
    setToast('❤️ Mehr davon gemerkt');
  }, []);

  const autoPickInSec = useMemo(() => {
    if (!currentTrack) return 0;
    const demoEnd = currentTrack.durationMs * MOCK_LOOP_DEMO_DURATION_FACTOR;
    return Math.max(0, Math.round((demoEnd - progressMs) / 1000));
  }, [currentTrack, progressMs]);

  return {
    currentTrack,
    candidates,
    committedId,
    progressMs,
    moodCounts,
    activePlaylists,
    currentQuestion,
    autoPickInSec,
    toast,
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
  };
}
