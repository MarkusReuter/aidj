'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  MOOD_TAGS,
  type Library,
  type LibraryTrack,
  type MoodTag,
} from '@/lib/library-schema';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; trackCount: number; at: number }
  | { kind: 'error'; message: string };

type Props = {
  initialLibrary: Library;
};

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function tracksEqual(a: LibraryTrack[], b: LibraryTrack[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function LibraryEditor({ initialLibrary }: Props) {
  const [tracks, setTracks] = useState<LibraryTrack[]>(initialLibrary.tracks);
  // Baseline = letzter persistierter Stand. Nach erfolgreichem Save auf den
  // gerade gespeicherten Stand gesetzt, sonst kippt isDirty nie zurück (die
  // Server-Component remountet nur bei builtAt-Wechsel, und ein PUT ändert
  // builtAt nicht).
  const [baseline, setBaseline] = useState<LibraryTrack[]>(
    initialLibrary.tracks,
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const isDirty = useMemo(
    () => !tracksEqual(tracks, baseline),
    [tracks, baseline],
  );

  const updateTrack = useCallback(
    (uri: string, patch: Partial<LibraryTrack>) => {
      setTracks((prev) =>
        prev.map((t) => (t.uri === uri ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  const toggleMood = useCallback(
    (uri: string, tag: MoodTag) => {
      setTracks((prev) =>
        prev.map((t) => {
          if (t.uri !== uri) return t;
          const has = t.moodTags.includes(tag);
          return {
            ...t,
            moodTags: has
              ? t.moodTags.filter((m) => m !== tag)
              : [...t.moodTags, tag],
          };
        }),
      );
    },
    [],
  );

  const removeTrack = useCallback((uri: string) => {
    setTracks((prev) => prev.filter((t) => t.uri !== uri));
  }, []);

  const clearAll = useCallback(() => {
    if (tracks.length === 0) return;
    const ok = window.confirm(
      `Wirklich alle ${tracks.length} Tracks aus der Library entfernen? Wird erst beim "Speichern" persistiert.`,
    );
    if (!ok) return;
    setTracks([]);
  }, [tracks.length]);

  const onSave = useCallback(async () => {
    setSaveState({ kind: 'saving' });
    // Snapshot des Stands, der gerade rausgeschickt wird — damit baseline
    // exakt dem entspricht, was der Server geschrieben hat (nicht dem, was
    // zwischenzeitlich im UI weitergetippt wurde).
    const sentTracks = tracks;
    try {
      const res = await fetch('/api/library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builtAt: initialLibrary.builtAt, tracks: sentTracks }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveState({
          kind: 'error',
          message:
            typeof body?.message === 'string'
              ? body.message
              : `HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as { ok: boolean; trackCount: number };
      setBaseline(sentTracks);
      setSaveState({
        kind: 'saved',
        trackCount: body.trackCount,
        at: Date.now(),
      });
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unbekannter Fehler',
      });
    }
  }, [tracks, initialLibrary.builtAt]);

  return (
    <section>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Library Editor</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {tracks.length} Tracks
            {initialLibrary.builtAt
              ? ` · gebaut ${new Date(initialLibrary.builtAt).toLocaleString('de-DE')}`
              : ' · noch nicht via Build-Script gebaut (Demo-Library aus Mock-Daten)'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusBadge state={saveState} dirty={isDirty} />
          <button
            type="button"
            onClick={clearAll}
            disabled={tracks.length === 0 || saveState.kind === 'saving'}
            className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            title="Alle Tracks aus der Library entfernen"
          >
            Alle entfernen
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || saveState.kind === 'saving'}
            className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {saveState.kind === 'saving' && (
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {saveState.kind === 'saving' ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-md border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Cover</th>
              <th className="px-3 py-2">Title / Artist</th>
              <th className="px-3 py-2">Dauer</th>
              <th className="px-3 py-2">BPM</th>
              <th className="px-3 py-2">Spotify-Genres</th>
              <th className="px-3 py-2">Mood-Tags</th>
              <th className="px-3 py-2">Energy</th>
              <th className="px-3 py-2">
                <span className="sr-only">Entfernen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <TrackRow
                key={track.uri}
                track={track}
                onToggleMood={toggleMood}
                onUpdate={updateTrack}
                onRemove={removeTrack}
              />
            ))}
            {tracks.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-xs text-zinc-500"
                >
                  Library ist leer. Über "Library bauen" oben neue Tracks
                  laden oder die Datei direkt befüllen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SaveStatusBadge({
  state,
  dirty,
}: {
  state: SaveState;
  dirty: boolean;
}) {
  if (state.kind === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
        <span
          aria-hidden
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        Speichere…
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="text-xs text-red-400" title={state.message}>
        Fehler: {state.message}
      </span>
    );
  }
  if (state.kind === 'saved' && !dirty) {
    return (
      <span className="text-xs text-emerald-400">
        Gespeichert ({state.trackCount} Tracks)
      </span>
    );
  }
  if (dirty) {
    return <span className="text-xs text-amber-400">Ungespeicherte Änderungen</span>;
  }
  return <span className="text-xs text-zinc-500">Keine Änderungen</span>;
}

function TrackRow({
  track,
  onToggleMood,
  onUpdate,
  onRemove,
}: {
  track: LibraryTrack;
  onToggleMood: (uri: string, tag: MoodTag) => void;
  onUpdate: (uri: string, patch: Partial<LibraryTrack>) => void;
  onRemove: (uri: string) => void;
}) {
  return (
    <tr className="border-t border-zinc-800 align-top">
      <td className="px-3 py-3">
        {track.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.coverUrl}
            alt=""
            className="h-14 w-14 rounded object-cover"
          />
        ) : (
          <div className="h-14 w-14 rounded bg-zinc-800" />
        )}
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-zinc-100">{track.title}</div>
        <div className="text-xs text-zinc-400">{track.artist}</div>
        <div className="mt-1 font-mono text-[10px] text-zinc-600">
          {track.uri}
        </div>
      </td>
      <td className="px-3 py-3 text-zinc-300">
        {formatDuration(track.durationMs)}
      </td>
      <td className="px-3 py-3 text-zinc-300">
        {track.bpm ?? <span className="text-zinc-600">—</span>}
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-xs flex-wrap gap-1">
          {track.spotifyGenres.length === 0 ? (
            <span className="text-xs text-zinc-600">keine</span>
          ) : (
            track.spotifyGenres.map((g) => (
              <span
                key={g}
                className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300"
              >
                {g}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-xs flex-wrap gap-1">
          {MOOD_TAGS.map((tag) => {
            const active = track.moodTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleMood(track.uri, tag)}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-3">
        <EnergyControl
          value={track.energyLevel}
          onChange={(v) => onUpdate(track.uri, { energyLevel: v })}
        />
      </td>
      <td className="px-3 py-3 text-right">
        <button
          type="button"
          onClick={() => onRemove(track.uri)}
          className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-400 hover:bg-red-900/50 hover:text-red-200"
          title={`"${track.title}" entfernen`}
          aria-label={`"${track.title}" entfernen`}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

function EnergyControl({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label="Energy-Level (1-10)"
        title="Energy-Level (1-10)"
        min={1}
        max={10}
        step={1}
        value={value ?? 5}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-purple-600"
        disabled={value === null}
      />
      <span className="w-6 text-right font-mono text-xs text-zinc-300">
        {value ?? '—'}
      </span>
      <button
        type="button"
        onClick={() => onChange(value === null ? 5 : null)}
        className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
        title={value === null ? 'Energy setzen' : 'Energy löschen'}
      >
        {value === null ? 'setzen' : 'leeren'}
      </button>
    </div>
  );
}
