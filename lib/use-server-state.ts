'use client';

/**
 * Client-Hook für die SSE-Pipeline. Drop-in-Ersatz für `useMockLoop`:
 * gleiche Result-Shape, gleiche Handler-Signaturen, sodass Tablet/Phone-Pages
 * nur eine Zeile (den Hook-Import) tauschen müssen.
 *
 * Architektur:
 *   - Single EventSource auf `/api/state/stream`. Browser reconnected
 *     automatisch bei Disconnect; wir verstärken das via `visibilitychange`:
 *     wenn das Tab nach Background wieder sichtbar wird und das letzte
 *     Snapshot älter als 10 s ist, schließen wir manuell und reconnecten.
 *   - `progressMs` interpolieren wir lokal mit `requestAnimationFrame` —
 *     SSE pusht nur alle 5 s, das wäre für den Progress-Bar zu ruckelig.
 *   - Toasts (für Anti-Buttons + Fehler) bleiben rein clientseitig, wie im
 *     Mock-Loop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MoodOption, MoodQuestion, Track } from '@/lib/mock-data';
import type { StateSnapshot } from '@/lib/server-state-types';

const STALE_SNAPSHOT_MS = 10_000;
const TOAST_MS = 1500;

export type UseServerStateResult = {
  currentTrack: Track | undefined;
  candidates: Track[];
  committedId: string | null;
  progressMs: number;
  moodCounts: Record<string, number>;
  activePlaylists: Set<string>;
  currentQuestion: MoodQuestion | undefined;
  autoPickInSec: number;
  toast: string | null;
  spotifyConnected: boolean;
  deviceName: string | null;
  onCandidateTap: (id: string) => void;
  onMoodPress: (value: string) => void;
  onPlaylistToggle: (p: string) => void;
  onSkip: () => void;
  onDislike: () => void;
  onLove: () => void;
};

function snapshotToHookResult(snapshot: StateSnapshot | null): {
  currentTrack: Track | undefined;
  candidates: Track[];
  currentQuestion: MoodQuestion | undefined;
  moodCounts: Record<string, number>;
  activePlaylists: Set<string>;
  committedId: string | null;
} {
  if (!snapshot) {
    return {
      currentTrack: undefined,
      candidates: [],
      currentQuestion: undefined,
      moodCounts: {},
      activePlaylists: new Set(),
      committedId: null,
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
    committedId: snapshot.committedId,
  };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function useServerState(): UseServerStateResult {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [progressMs, setProgressMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const snapshotRef = useRef<StateSnapshot | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Optimistic local overlays — werden vom nächsten Snapshot überschrieben.
  const [optimisticCommittedId, setOptimisticCommittedId] = useState<string | null>(null);

  // SSE-Verbindung. Stabile Funktion, damit visibilitychange sie reusen kann.
  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
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
      // EventSource reconnected selbst; wir loggen nur.
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

  // Reconnect-Hardening: bfcache-Restoration + Background-Tabwechsel.
  // `pageshow` mit `event.persisted === true` ist der zuverlaessige Marker
  // fuer bfcache (back-forward cache) — Chrome/Safari restoren die Seite mit
  // eingefrorenem EventSource, der dann tot bleibt. Wir machen Hand-Reconnect.
  // Zusaetzlich `visibilitychange` als Sicherheitsnetz fuer Tab-Sleep.
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

  // Progress-Interpolation via rAF — läuft nur, wenn isPlaying und ein Track da.
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

  const onCandidateTap = useCallback(async (id: string) => {
    setOptimisticCommittedId(id);
    const res = await postJson('/api/queue/commit', { trackId: id });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (data?.error === 'no_active_device') {
        setToast('🔌 Kein aktives Spotify-Device — öffne Spotify');
      } else if (data?.error === 'not_connected') {
        setToast('⚠ Spotify nicht verbunden');
      } else {
        setToast('⚠ Konnte Track nicht queuen');
      }
      setOptimisticCommittedId(null);
    }
  }, []);

  const onMoodPress = useCallback((value: string) => {
    void postJson('/api/state/button', { type: 'mood', value });
  }, []);

  const onPlaylistToggle = useCallback((value: string) => {
    void postJson('/api/state/button', { type: 'playlist', value });
  }, []);

  const onSkip = useCallback(() => {
    setToast('⏭ Skip kommt mit Phase 5');
  }, []);

  const onDislike = useCallback(() => {
    void postJson('/api/state/button', { type: 'anti', value: 'dislike' });
    setToast('👎 Nicht das gemerkt');
  }, []);

  const onLove = useCallback(() => {
    void postJson('/api/state/button', { type: 'anti', value: 'love' });
    setToast('❤️ Mehr davon gemerkt');
  }, []);

  return {
    ...derived,
    committedId: effectiveCommittedId,
    progressMs,
    autoPickInSec,
    toast,
    spotifyConnected: snapshot?.spotify.connected ?? false,
    deviceName:
      snapshot?.spotify.connected ? snapshot.spotify.deviceName : null,
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
  };
}
