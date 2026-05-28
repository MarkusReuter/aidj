'use client';

/**
 * Client-Hook für die SSE-Pipeline. Wird von Tablet (`mode: 'host'`) und
 * Phone (`mode: 'guest'`) genutzt — die Datenquelle ist identisch, nur das
 * Tap-Verhalten unterscheidet sich:
 *
 *   - **host** → Candidate-Tap committet sofort in die Spotify-Queue
 *     (Host-Privileg, kein Quota). Endpoint: `/api/queue/commit`.
 *   - **guest** → Candidate-Tap submittet als Gast-Wunsch mit 1-Slot-Quota
 *     pro Gast. Endpoint: `/api/guest/submit`. Zusätzlich wird derselbe
 *     Submit-Pfad für Such-Picks (`submitGuestTrack`) exponiert.
 *
 * Architektur:
 *   - Single EventSource auf `/api/state/stream`.
 *   - `pageshow` (bfcache) + `visibilitychange` für Reconnect-Hardening.
 *   - `progressMs` lokal via rAF zwischen Snapshots interpoliert (SSE
 *     pusht nur alle 5 s).
 *   - Toasts (Anti-Buttons + Fehler) sind rein clientseitig.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MoodOption, MoodQuestion, Track } from '@/lib/mock-data';
import type {
  FilterNotice,
  SnapshotGuestEntry,
  StateSnapshot,
} from '@/lib/server-state-types';

const STALE_SNAPSHOT_MS = 10_000;
const TOAST_MS = 1500;

export type GuestTrackMeta = {
  title: string;
  artist: string;
  coverUrl: string;
  durationMs: number;
};

export type SubmitGuestTrackFn = (
  trackUri: string,
  meta: GuestTrackMeta,
) => Promise<{ ok: boolean }>;

export type UseServerStateResult = {
  currentTrack: Track | undefined;
  candidates: Track[];
  committedId: string | null;
  progressMs: number;
  moodCounts: Record<string, number>;
  activePlaylists: Set<string>;
  /** Filter-Modus (Host-Setting): zeigt der Button Playlists oder Genres. */
  filterMode: 'playlists' | 'genres';
  /** Verfügbare Filter-Labels im aktuellen Modus, aus der Library abgeleitet. */
  filterOptions: string[];
  /** Gesetzt, wenn der aktive Filter zu wenige Tracks hatte (aufgefüllt). */
  filterNotice: FilterNotice | null;
  /** Ob BPM angezeigt + berücksichtigt wird (Host-Setting). */
  bpmEnabled: boolean;
  currentQuestion: MoodQuestion | undefined;
  autoPickInSec: number;
  toast: string | null;
  spotifyConnected: boolean;
  deviceName: string | null;
  guestQueue: SnapshotGuestEntry[];
  mySubmission: SnapshotGuestEntry | null;
  onCandidateTap: (id: string) => void;
  onMoodPress: (value: string) => void;
  onPlaylistToggle: (p: string) => void;
  onSkip: () => void;
  onDislike: () => void;
  onLove: () => void;
  /** Plan2: Long-Press-Delete-Geste auf einer Gast-Wunsch-Karte (Tablet). */
  onRemoveWish: (submissionId: string) => Promise<{ ok: boolean }>;
  submitGuestTrack: SubmitGuestTrackFn;
};

export type UseServerStateParams =
  | { mode: 'host' }
  | { mode: 'guest'; guestId: string | null; guestName: string };

function snapshotToHookResult(snapshot: StateSnapshot | null): {
  currentTrack: Track | undefined;
  candidates: Track[];
  currentQuestion: MoodQuestion | undefined;
  moodCounts: Record<string, number>;
  activePlaylists: Set<string>;
  filterMode: 'playlists' | 'genres';
  filterOptions: string[];
  filterNotice: FilterNotice | null;
  bpmEnabled: boolean;
  committedId: string | null;
  guestQueue: SnapshotGuestEntry[];
} {
  if (!snapshot) {
    return {
      currentTrack: undefined,
      candidates: [],
      currentQuestion: undefined,
      moodCounts: {},
      activePlaylists: new Set(),
      filterMode: 'playlists',
      filterOptions: [],
      filterNotice: null,
      bpmEnabled: true,
      committedId: null,
      guestQueue: [],
    };
  }
  return {
    currentTrack: snapshot.currentTrack
      ? (snapshot.currentTrack as Track)
      : undefined,
    candidates: snapshot.candidates as Track[],
    currentQuestion: snapshot.currentMoodQuestion
      ? ({
          id: snapshot.currentMoodQuestion.id,
          question: snapshot.currentMoodQuestion.question,
          options: snapshot.currentMoodQuestion.options as MoodOption[],
        } satisfies MoodQuestion)
      : undefined,
    moodCounts: snapshot.moodCounts,
    activePlaylists: new Set(snapshot.activePlaylists),
    filterMode: snapshot.filterMode,
    filterOptions: snapshot.filterOptions,
    filterNotice: snapshot.filterNotice,
    bpmEnabled: snapshot.bpmEnabled,
    committedId: snapshot.committedId,
    guestQueue: snapshot.guestQueue,
  };
}

async function postJson(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

function newSubmissionId(): string {
  return (
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)) +
    '-' +
    Date.now().toString(36)
  );
}

export function useServerState(
  params: UseServerStateParams = { mode: 'host' },
): UseServerStateResult {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const snapshotRef = useRef<StateSnapshot | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const [optimisticCommittedId, setOptimisticCommittedId] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource('/api/state/stream');
    esRef.current = es;
    es.addEventListener('snapshot', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as StateSnapshot;
        snapshotRef.current = data;
        setSnapshot(data);
        setOptimisticCommittedId(null);
      } catch (err) {
        console.warn('[useServerState] failed to parse snapshot', err);
      }
    });
    es.addEventListener('error', () => {
      console.debug('[useServerState] EventSource error (browser will retry)');
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) connect();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const last = snapshotRef.current?.snapshotAt ?? 0;
      if (Date.now() - last > STALE_SNAPSHOT_MS) connect();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [connect]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const s = snapshotRef.current;
      if (s && s.currentTrack) {
        const base = s.progressMs;
        const elapsed = s.isPlaying ? Date.now() - s.snapshotAt : 0;
        const next = Math.min(s.currentTrack.durationMs, base + elapsed);
        setProgressMs(next);
      } else {
        setProgressMs(0);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  const derived = useMemo(() => snapshotToHookResult(snapshot), [snapshot]);
  const effectiveCommittedId = optimisticCommittedId ?? derived.committedId;

  const autoPickInSec = useMemo(() => {
    if (!derived.currentTrack) return 0;
    const remaining = derived.currentTrack.durationMs - progressMs;
    return Math.max(0, Math.round(remaining / 1000));
  }, [derived.currentTrack, progressMs]);

  // Mein eigener aktiver Gast-Eintrag (für Quota-Anzeige + UI-Status).
  const mySubmission = useMemo(() => {
    if (params.mode !== 'guest' || !params.guestId) return null;
    return (
      derived.guestQueue.find(
        (e) => e.guestId === params.guestId && e.status !== 'done',
      ) ?? null
    );
  }, [derived.guestQueue, params]);

  // Submit-Pfad — wird sowohl von onCandidateTap (guest-mode) als auch von
  // SearchAutocomplete-Picks aufgerufen.
  const submitGuestTrack = useCallback<SubmitGuestTrackFn>(
    async (trackUri, meta) => {
      if (params.mode !== 'guest') {
        setToast('⚠ Submit nicht im Host-Mode verfügbar');
        return { ok: false };
      }
      if (!params.guestId) {
        setToast('⏳ Lade Gast-ID...');
        return { ok: false };
      }
      const res = await postJson(
        '/api/guest/submit',
        {
          trackUri,
          trackMeta: meta,
          submissionId: newSubmissionId(),
          guestName: params.guestName,
        },
        { 'X-Guest-Id': params.guestId },
      );
      if (res.ok) return { ok: true };
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      switch (data?.error) {
        case 'quota_exceeded':
          setToast('⚠ Du hast schon einen Track in der Queue');
          break;
        case 'queue_full':
          setToast('⚠ Gast-Queue ist voll');
          break;
        case 'no_active_device':
          setToast('🔌 Kein aktives Spotify-Device');
          break;
        case 'not_connected':
          setToast('⚠ Spotify nicht verbunden');
          break;
        default:
          setToast('⚠ Konnte Track nicht queuen');
      }
      return { ok: false };
    },
    [params],
  );

  const onCandidateTap = useCallback(
    async (id: string) => {
      if (params.mode === 'host') {
        // Plan2: Tap setzt nur committedId. Kein Spotify-Push hier — der
        // passiert erst im Lock-Window oder via Skip.
        setOptimisticCommittedId(id);
        const res = await postJson('/api/queue/commit', { trackId: id });
        if (!res.ok) {
          setToast('⚠ Konnte Auswahl nicht setzen');
          setOptimisticCommittedId(null);
        }
        return;
      }
      // Guest-Mode: Submit über Gast-Queue. trackId entspricht der Spotify-URI
      // im SnapshotTrack (siehe lib/state.ts → spotifyNowPlayingToTrack).
      const candidate = snapshotRef.current?.candidates.find((c) => c.id === id);
      if (!candidate) {
        setToast('⚠ Kandidat nicht mehr verfügbar — refresh');
        return;
      }
      await submitGuestTrack(candidate.id, {
        title: candidate.title,
        artist: candidate.artist,
        coverUrl: candidate.coverUrl,
        durationMs: candidate.durationMs,
      });
    },
    [params, submitGuestTrack],
  );

  const onMoodPress = useCallback((value: string) => {
    void postJson('/api/state/button', { type: 'mood', value });
  }, []);

  const onPlaylistToggle = useCallback((value: string) => {
    void postJson('/api/state/button', { type: 'playlist', value });
  }, []);

  const onSkip = useCallback(async () => {
    setToast('⏭ Skip…');
    try {
      const res = await fetch('/api/state/skip', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setToast(`⚠ ${body.message ?? `HTTP ${res.status}`}`);
        return;
      }
      setToast('⏭ Übersprungen');
    } catch (err) {
      setToast(`⚠ ${err instanceof Error ? err.message : 'Skip fehlgeschlagen'}`);
    }
  }, []);

  const onDislike = useCallback(() => {
    void postJson('/api/state/button', { type: 'anti', value: 'dislike' });
    setToast('👎 Nicht das gemerkt');
  }, []);

  const onLove = useCallback(() => {
    void postJson('/api/state/button', { type: 'anti', value: 'love' });
    setToast('❤️ Mehr davon gemerkt');
  }, []);

  const onRemoveWish = useCallback(
    async (submissionId: string): Promise<{ ok: boolean }> => {
      const res = await postJson('/api/queue/remove', { submissionId });
      if (!res.ok) {
        setToast('⚠ Konnte Wunsch nicht entfernen');
        return { ok: false };
      }
      setToast('🗑 Wunsch entfernt');
      return { ok: true };
    },
    [],
  );

  return {
    ...derived,
    committedId: effectiveCommittedId,
    progressMs,
    autoPickInSec,
    toast,
    spotifyConnected: snapshot?.spotify.connected ?? false,
    deviceName:
      snapshot?.spotify.connected ? snapshot.spotify.deviceName : null,
    mySubmission,
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
    onRemoveWish,
    submitGuestTrack,
  };
}
