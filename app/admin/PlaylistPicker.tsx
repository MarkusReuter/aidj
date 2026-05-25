'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Playlist = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  isOwn: boolean;
  trackCount: number;
  coverUrl: string | null;
};

type FetchError =
  | { kind: 'not_connected' }
  | { kind: 'reauth_required' }
  | { kind: 'other'; message: string };

type Mode =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'picking' }
  | { kind: 'building'; jobId: string; bpmEnabled: boolean }
  | {
      kind: 'done';
      trackCount: number;
      addedCount: number;
      alreadyPresentCount: number;
      bpmHits: number;
      skippedPlaylists: string[];
    }
  | { kind: 'error'; message: string };

type Warning = { playlistId?: string; message: string };

type ProgressState = {
  phase: string;
  currentIndex: number;
  totalTracks: number;
  bpmHits: number;
  bpmMisses: number;
};

type StreamedTrack = {
  uri: string;
  title: string;
  artist: string;
  bpm: number | null;
};

export default function PlaylistPicker() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [fetchError, setFetchError] = useState<FetchError | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [ownFirst, setOwnFirst] = useState(true);

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [streamedTracks, setStreamedTracks] = useState<StreamedTrack[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const sourceRef = useRef<EventSource | null>(null);
  // Wenn wir done/error schon gesehen haben, ignoriert der native SSE-`error`-
  // Handler weitere Events (sonst überschreibt ein post-done Disconnect den
  // erfolgreichen Done-State mit einer Fehlermeldung).
  const streamFinishedRef = useRef(false);
  // Cleanup beim Unmount.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const loadPlaylists = useCallback(async () => {
    setMode({ kind: 'loading' });
    setFetchError(null);
    try {
      const res = await fetch('/api/spotify/playlists');
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFetchError({
          kind:
            body.error === 'reauth_required'
              ? 'reauth_required'
              : 'not_connected',
        });
        setMode({ kind: 'idle' });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setFetchError({
          kind: 'other',
          message: body.message ?? `HTTP ${res.status}`,
        });
        setMode({ kind: 'idle' });
        return;
      }
      const data = (await res.json()) as { playlists: Playlist[] };
      setPlaylists(data.playlists);
      setMode({ kind: 'picking' });
    } catch (err) {
      setFetchError({
        kind: 'other',
        message: err instanceof Error ? err.message : String(err),
      });
      setMode({ kind: 'idle' });
    }
  }, []);

  const filteredSorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q
      ? playlists.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.ownerName.toLowerCase().includes(q),
        )
      : playlists;
    if (!ownFirst) return matched;
    return [...matched].sort((a, b) => {
      if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [playlists, filter, ownFirst]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedSummary = useMemo(() => {
    if (selected.size === 0) return null;
    const picks = playlists.filter((p) => selected.has(p.id));
    const total = picks.reduce((sum, p) => sum + p.trackCount, 0);
    return { count: picks.length, totalTracks: total };
  }, [playlists, selected]);

  const attachToStream = useCallback(
    (jobId: string, bpmEnabled: boolean) => {
      sourceRef.current?.close();
      streamFinishedRef.current = false;
      setProgress(null);
      setStreamedTracks([]);
      setWarnings([]);
      setMode({ kind: 'building', jobId, bpmEnabled });

      const es = new EventSource(`/api/library/build/${jobId}/stream`);
      sourceRef.current = es;

      es.addEventListener('phase', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as {
            phase: string;
            message: string;
          };
          setProgress((prev) => ({
            phase: data.phase,
            currentIndex: prev?.currentIndex ?? 0,
            totalTracks: prev?.totalTracks ?? 0,
            bpmHits: prev?.bpmHits ?? 0,
            bpmMisses: prev?.bpmMisses ?? 0,
          }));
        } catch {
          // ignore
        }
      });

      es.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as {
            currentIndex: number;
            totalTracks: number;
            bpmHits: number;
            bpmMisses: number;
          };
          setProgress((prev) => ({
            phase: prev?.phase ?? 'tracks',
            currentIndex: data.currentIndex,
            totalTracks: data.totalTracks,
            bpmHits: data.bpmHits,
            bpmMisses: data.bpmMisses,
          }));
        } catch {
          // ignore
        }
      });

      es.addEventListener('warning', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as Warning;
          setWarnings((prev) => [...prev, data]);
        } catch {
          // ignore
        }
      });

      es.addEventListener('track', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as {
            track: { uri: string; title: string; artist: string; bpm: number | null };
          };
          setStreamedTracks((prev) => {
            // Letzte 20 reichen — sonst wird die Liste lang.
            const next = [...prev, data.track];
            return next.length > 20 ? next.slice(-20) : next;
          });
        } catch {
          // ignore
        }
      });

      es.addEventListener('done', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as {
            trackCount: number;
            addedCount: number;
            alreadyPresentCount: number;
            bpmHits: number;
            skippedPlaylists?: string[];
          };
          setMode({
            kind: 'done',
            trackCount: data.trackCount,
            addedCount: data.addedCount,
            alreadyPresentCount: data.alreadyPresentCount,
            bpmHits: data.bpmHits,
            skippedPlaylists: data.skippedPlaylists ?? [],
          });
        } finally {
          streamFinishedRef.current = true;
          es.close();
          sourceRef.current = null;
          // Server-Components der /admin-Seite neu laden → LibraryEditor
          // remountet via Key-Bump auf `library.builtAt`.
          router.refresh();
        }
      });

      es.addEventListener('error', (e) => {
        // Native `error` feuert auch beim Server-side-Close nach `done` —
        // dann ignorieren, sonst überschreiben wir den Done-State.
        if (streamFinishedRef.current) return;
        const msg =
          (e as MessageEvent).data != null
            ? (() => {
                try {
                  return (
                    JSON.parse((e as MessageEvent).data) as { message?: string }
                  ).message ?? 'Unbekannter Build-Fehler';
                } catch {
                  return 'Unbekannter Build-Fehler';
                }
              })()
            : 'SSE-Verbindung verloren';
        streamFinishedRef.current = true;
        setMode({ kind: 'error', message: msg });
        es.close();
        sourceRef.current = null;
      });
    },
    [router],
  );

  const startBuild = useCallback(async () => {
    if (selected.size === 0) return;
    setProgress(null);
    setStreamedTracks([]);
    try {
      const res = await fetch('/api/library/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistIds: Array.from(selected) }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          jobId?: string;
          message?: string;
        };
        if (body.jobId) {
          // An laufenden Job attachen statt zu warten.
          attachToStream(body.jobId, true);
          return;
        }
        setMode({
          kind: 'error',
          message: body.message ?? 'Build läuft schon, aber keine Job-ID erhalten.',
        });
        return;
      }
      if (res.status === 401) {
        const body = (await res.json()) as { error?: string };
        setFetchError({
          kind:
            body.error === 'reauth_required'
              ? 'reauth_required'
              : 'not_connected',
        });
        setMode({ kind: 'picking' });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setMode({
          kind: 'error',
          message: body.message ?? `HTTP ${res.status}`,
        });
        return;
      }

      const body = (await res.json()) as {
        jobId: string;
        bpmEnabled: boolean;
      };
      attachToStream(body.jobId, body.bpmEnabled);
    } catch (err) {
      setMode({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [selected, attachToStream]);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setMode(playlists.length > 0 ? { kind: 'picking' } : { kind: 'idle' });
    setProgress(null);
    setStreamedTracks([]);
  }, [playlists.length]);

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Library bauen</h2>
        <p className="text-xs text-zinc-500">
          Spotify-Playlists wählen → Library mit Genres + BPM bauen
        </p>
      </header>

      {fetchError && (
        <ReauthBanner
          error={fetchError}
          onDismiss={() => setFetchError(null)}
        />
      )}

      {mode.kind === 'idle' && !fetchError && (
        <button
          type="button"
          onClick={loadPlaylists}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-purple-500"
        >
          Playlists aus Spotify laden
        </button>
      )}

      {mode.kind === 'loading' && (
        <p className="text-sm text-zinc-400">Lade Playlists…</p>
      )}

      {(mode.kind === 'picking' ||
        mode.kind === 'building' ||
        mode.kind === 'done' ||
        mode.kind === 'error') &&
        playlists.length > 0 && (
          <>
            <div className="mb-3 flex items-center gap-3">
              <input
                type="search"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={mode.kind === 'building'}
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm placeholder-zinc-600 focus:border-purple-600 focus:outline-none disabled:opacity-50"
              />
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={ownFirst}
                  onChange={(e) => setOwnFirst(e.target.checked)}
                  className="accent-purple-600"
                  disabled={mode.kind === 'building'}
                />
                Eigene zuerst
              </label>
              <button
                type="button"
                onClick={loadPlaylists}
                disabled={mode.kind === 'building'}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                title="Liste neu laden"
              >
                ↻
              </button>
            </div>

            <ul className="mb-4 max-h-80 overflow-y-auto rounded-md border border-zinc-800">
              {filteredSorted.map((p) => {
                const isChecked = selected.has(p.id);
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 border-b border-zinc-800 px-3 py-2 last:border-b-0 ${
                      isChecked ? 'bg-purple-950/30' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Playlist "${p.name}" auswählen`}
                      checked={isChecked}
                      onChange={() => toggleSelected(p.id)}
                      disabled={mode.kind === 'building'}
                      className="h-4 w-4 accent-purple-600"
                    />
                    {p.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.coverUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-zinc-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-100">
                        {p.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {p.trackCount} Tracks · {p.ownerName}
                        {p.isOwn && (
                          <span className="ml-1.5 rounded bg-purple-900/40 px-1 text-[10px] text-purple-300">
                            eigene
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
              {filteredSorted.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-zinc-500">
                  Keine Playlists matchen den Filter.
                </li>
              )}
            </ul>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={startBuild}
                disabled={
                  selected.size === 0 ||
                  mode.kind === 'building'
                }
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {mode.kind === 'building'
                  ? 'Build läuft…'
                  : selectedSummary
                    ? `Library bauen — ${selectedSummary.count} Playlist${selectedSummary.count > 1 ? 's' : ''}, ~${selectedSummary.totalTracks} Tracks`
                    : 'Library bauen'}
              </button>
              {mode.kind === 'building' && (
                <p className="text-xs text-amber-400">
                  App-Prozess während Build nicht neustarten.
                </p>
              )}
            </div>
          </>
        )}

      {mode.kind === 'building' && (
        <BuildStatus
          progress={progress}
          streamedTracks={streamedTracks}
          bpmEnabled={mode.bpmEnabled}
          warnings={warnings}
          playlists={playlists}
        />
      )}

      {mode.kind === 'done' && (
        <div className="mt-4 rounded-md border border-emerald-900/50 bg-emerald-950/30 p-3">
          <p className="text-sm text-emerald-300">
            Build fertig — {mode.addedCount}{' '}
            {mode.addedCount === 1 ? 'Track' : 'Tracks'} neu hinzugefügt
            {mode.alreadyPresentCount > 0 && (
              <span className="text-emerald-400/80">
                {' '}
                · {mode.alreadyPresentCount} schon im Bestand (übersprungen)
              </span>
            )}
            {mode.bpmHits > 0 && (
              <span className="text-emerald-400/80"> · {mode.bpmHits} BPM-Hits</span>
            )}
            . Library hat jetzt {mode.trackCount}{' '}
            {mode.trackCount === 1 ? 'Track' : 'Tracks'} insgesamt.
          </p>
          {mode.skippedPlaylists.length > 0 && (
            <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-2">
              <p className="text-xs font-medium text-amber-200">
                {mode.skippedPlaylists.length} Playlist
                {mode.skippedPlaylists.length > 1 ? 's' : ''} übersprungen (403
                von Spotify):
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-amber-300/80">
                {mode.skippedPlaylists.map((pid) => {
                  const meta = playlists.find((p) => p.id === pid);
                  return (
                    <li key={pid}>
                      • {meta?.name ?? pid}
                      {meta && (
                        <span className="text-amber-400/60">
                          {' · '}Owner: {meta.ownerName}
                          {meta.isOwn ? ' (eigene)' : ' (gefolgt)'}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-amber-400/70">
                Spotify schränkt manche Playlists im Developer-Mode ein (auch
                eigene). Voller Endpoint-Zugriff erfordert Production-Mode
                (Approval-Prozess im{' '}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Spotify-Dashboard
                </a>
                ). Bis dahin: betroffene Tracks ggf. einzeln in eine neue
                Playlist kopieren und damit neu builden.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-2 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Zurück zur Playlist-Auswahl
          </button>
        </div>
      )}

      {mode.kind === 'error' && (
        <div className="mt-4 rounded-md border border-red-900/50 bg-red-950/30 p-3">
          <p className="text-sm text-red-300">
            Fehler: {mode.message}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Zurück
          </button>
        </div>
      )}
    </section>
  );
}

function ReauthBanner({
  error,
  onDismiss,
}: {
  error: FetchError;
  onDismiss: () => void;
}) {
  if (error.kind === 'other') {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-900/50 bg-red-950/30 p-3">
        <p className="text-sm text-red-300">Fehler: {error.message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          OK
        </button>
      </div>
    );
  }
  const isReauth = error.kind === 'reauth_required';
  return (
    <div className="mb-4 rounded-md border border-amber-900/50 bg-amber-950/30 p-3">
      <p className="text-sm text-amber-200">
        {isReauth
          ? 'Spotify-Berechtigungen reichen nicht — neu verbinden, damit die App auf deine Playlists zugreifen darf.'
          : 'Spotify ist nicht verbunden.'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <a
          href="/api/spotify/auth"
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500"
        >
          Spotify verbinden
        </a>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          Schließen
        </button>
      </div>
    </div>
  );
}

function BuildStatus({
  progress,
  streamedTracks,
  bpmEnabled,
  warnings,
  playlists,
}: {
  progress: ProgressState | null;
  streamedTracks: StreamedTrack[];
  bpmEnabled: boolean;
  warnings: Warning[];
  playlists: Playlist[];
}) {
  return (
    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900 p-3">
      {!progress && (
        <p className="text-sm text-zinc-400">Build startet…</p>
      )}
      {progress && (
        <>
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-300">
            <span>
              Phase: {progress.phase} ·{' '}
              {progress.totalTracks > 0
                ? `Tracks ${progress.currentIndex}/${progress.totalTracks}`
                : '…'}
            </span>
            <span className="text-zinc-500">
              {bpmEnabled
                ? `BPM-Hits ${progress.bpmHits} · Misses ${progress.bpmMisses}`
                : 'ohne BPM-Daten'}
            </span>
          </div>
          {progress.totalTracks > 0 && (
            <div
              title={`${progress.currentIndex} von ${progress.totalTracks} Tracks`}
              className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800"
            >
              <div
                className="h-full bg-purple-600 transition-all"
                // eslint-disable-next-line react/forbid-dom-props -- dynamische Width pro Render unvermeidbar inline.
                style={{
                  width: `${Math.round(
                    (progress.currentIndex / progress.totalTracks) * 100,
                  )}%`,
                }}
              />
            </div>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-[11px] text-amber-300">
          {warnings.map((w, idx) => {
            const meta = w.playlistId
              ? playlists.find((p) => p.id === w.playlistId)
              : undefined;
            return (
              <li key={idx}>
                ⚠ {meta ? `Playlist "${meta.name}" übersprungen (403)` : w.message}
              </li>
            );
          })}
        </ul>
      )}
      {streamedTracks.length > 0 && (
        <ul className="space-y-1 font-mono text-[11px] text-zinc-400">
          {streamedTracks.map((t, idx) => (
            <li key={`${t.uri}-${idx}`} className="truncate">
              ✓ {t.title} — {t.artist}{' '}
              {t.bpm !== null ? (
                <span className="text-zinc-500">— {t.bpm} BPM</span>
              ) : bpmEnabled ? (
                <span className="text-zinc-600">— (kein BPM)</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
