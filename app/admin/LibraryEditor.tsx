'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Library, LibraryTrack } from '@/lib/library-schema';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; trackCount: number; at: number }
  | { kind: 'error'; message: string };

type AutoTagState =
  | { kind: 'idle' }
  | {
      kind: 'running';
      requested: number;
      taggedTotal: number;
      batchIndex: number;
      totalBatches: number;
    }
  | {
      kind: 'done';
      tagged: number;
      requested: number;
      errors: string[];
      at: number;
    }
  | { kind: 'error'; message: string };

type AutoTagSuggestion = {
  uri: string;
  moodTags: string[];
  genres: string[];
  energyLevel: number;
};

type ProgressEvent = {
  batchIndex: number;
  batchesCompleted: number;
  totalBatches: number;
  batchSize: number;
  taggedInBatch: number;
  taggedTotal: number;
  totalTracks: number;
  tagged: AutoTagSuggestion[];
  error: string | null;
};

type DoneEvent = {
  provider: string;
  latencyMs: number;
  requested: number;
  taggedTotal: number;
  errors: string[];
};

type ErrorEvent = { error: string; message: string };

/**
 * Sehr minimaler SSE-Frame-Parser. Hält einen rolling buffer und gibt jede
 * vollständige `event:\ndata:\n\n`-Sequenz an den callback weiter. Reicht für
 * unseren eigenen Stream — keine multi-line data, kein retry-Feld, keine IDs.
 */
function makeSseParser(
  onEvent: (event: string, data: string) => void,
): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length > 0) onEvent(event, dataLines.join('\n'));
    }
  };
}

/**
 * Tag-Normalisierung muss zum Schema in `lib/library-schema.ts` passen
 * (`.trim().toLowerCase()`), sonst zeigt das UI „Peak" während der Server
 * den Tag als „peak" speichert und Re-Renders flackern.
 */
function normalizeTag(s: string): string {
  return s.trim().toLowerCase();
}

function isUntagged(t: LibraryTrack): boolean {
  return t.moodTags.length === 0 && t.energyLevel === null;
}

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
  const [autoTagState, setAutoTagState] = useState<AutoTagState>({
    kind: 'idle',
  });

  const isDirty = useMemo(
    () => !tracksEqual(tracks, baseline),
    [tracks, baseline],
  );

  const untaggedUris = useMemo(
    () => tracks.filter(isUntagged).map((t) => t.uri),
    [tracks],
  );

  // Library-weites Vokabular für Autocomplete + Datalist-Suggestions. So sieht
  // der Host beim Tippen, welche Tags er schon mal vergeben hat, und kann
  // einfach wiederverwenden statt Synonyme zu erfinden.
  const { moodVocab, genreVocab } = useMemo(() => {
    const m = new Set<string>();
    const g = new Set<string>();
    for (const t of tracks) {
      for (const tag of t.moodTags) m.add(tag);
      for (const gn of t.spotifyGenres) g.add(gn);
    }
    return {
      moodVocab: [...m].sort(),
      genreVocab: [...g].sort(),
    };
  }, [tracks]);

  const updateTrack = useCallback(
    (uri: string, patch: Partial<LibraryTrack>) => {
      setTracks((prev) =>
        prev.map((t) => (t.uri === uri ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  const addMoodTag = useCallback((uri: string, raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.uri !== uri) return t;
        if (t.moodTags.includes(tag)) return t;
        return { ...t, moodTags: [...t.moodTags, tag] };
      }),
    );
  }, []);

  const removeMoodTag = useCallback((uri: string, tag: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.uri === uri ? { ...t, moodTags: t.moodTags.filter((m) => m !== tag) } : t,
      ),
    );
  }, []);

  const addGenre = useCallback((uri: string, raw: string) => {
    const g = normalizeTag(raw);
    if (!g) return;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.uri !== uri) return t;
        if (t.spotifyGenres.includes(g)) return t;
        return { ...t, spotifyGenres: [...t.spotifyGenres, g] };
      }),
    );
  }, []);

  const removeGenre = useCallback((uri: string, g: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.uri === uri
          ? { ...t, spotifyGenres: t.spotifyGenres.filter((x) => x !== g) }
          : t,
      ),
    );
  }, []);

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

  const onAutoTag = useCallback(async () => {
    if (untaggedUris.length === 0 || autoTagState.kind === 'running') return;
    const requested = untaggedUris.length;
    setAutoTagState({
      kind: 'running',
      requested,
      taggedTotal: 0,
      batchIndex: 0,
      totalBatches: 0,
    });

    /**
     * Live-Patch eines Batches in den Editor-State. Tracks kriegen pro Batch
     * direkt Tags + Genres + Energy gesetzt, damit der Host beim Scrollen sieht
     * was bisher gemacht wurde. Persistiert wird erst beim "Speichern".
     */
    const applyBatch = (sugs: AutoTagSuggestion[]) => {
      if (sugs.length === 0) return;
      const patches = new Map(sugs.map((t) => [t.uri, t]));
      setTracks((prev) =>
        prev.map((t) => {
          const sug = patches.get(t.uri);
          if (!sug) return t;
          const mergedGenres = [
            ...t.spotifyGenres,
            ...sug.genres.filter((g) => !t.spotifyGenres.includes(g)),
          ];
          return {
            ...t,
            moodTags: sug.moodTags,
            energyLevel: sug.energyLevel,
            spotifyGenres: mergedGenres,
          };
        }),
      );
    };

    let terminal: 'done' | 'error' | null = null;

    try {
      const res = await fetch('/api/library/auto-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: untaggedUris }),
      });
      if (!res.ok || !res.body) {
        setAutoTagState({
          kind: 'error',
          message: `HTTP ${res.status}`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parse = makeSseParser((event, data) => {
        try {
          if (event === 'progress') {
            const ev = JSON.parse(data) as ProgressEvent;
            applyBatch(ev.tagged);
            setAutoTagState({
              kind: 'running',
              requested,
              taggedTotal: ev.taggedTotal,
              // batchesCompleted ist monoton, batchIndex ist die Slice-Position
              // und kommt bei Concurrency >1 out-of-order — Counter würde springen.
              batchIndex: ev.batchesCompleted,
              totalBatches: ev.totalBatches,
            });
          } else if (event === 'done') {
            const ev = JSON.parse(data) as DoneEvent;
            setAutoTagState({
              kind: 'done',
              tagged: ev.taggedTotal,
              requested: ev.requested,
              errors: ev.errors,
              at: Date.now(),
            });
            terminal = 'done';
          } else if (event === 'error') {
            const ev = JSON.parse(data) as ErrorEvent;
            setAutoTagState({ kind: 'error', message: ev.message });
            terminal = 'error';
          }
        } catch (parseErr) {
          console.warn('[auto-tag] parse error', parseErr, data);
        }
      });
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (value) parse(decoder.decode(value, { stream: true }));
        if (done) break;
      }
      // Server hat Stream geschlossen, ohne 'done' oder 'error' zu schicken.
      if (!terminal) {
        setAutoTagState({
          kind: 'error',
          message: 'Stream unerwartet beendet',
        });
      }
    } catch (err) {
      setAutoTagState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unbekannter Fehler',
      });
    }
  }, [untaggedUris, autoTagState.kind]);

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
          <AutoTagStatusBadge state={autoTagState} />
          <SaveStatusBadge state={saveState} dirty={isDirty} />
          <button
            type="button"
            onClick={onAutoTag}
            disabled={
              untaggedUris.length === 0 ||
              autoTagState.kind === 'running' ||
              saveState.kind === 'saving'
            }
            className="inline-flex items-center gap-2 rounded-md border border-sky-900/60 bg-sky-950/40 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
            title={
              untaggedUris.length === 0
                ? 'Alle Tracks haben schon Tags + Energy'
                : `LLM tagt ${untaggedUris.length} ungetaggte Track(s) — review vor "Speichern" möglich`
            }
          >
            {autoTagState.kind === 'running' && (
              <span
                aria-hidden
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {autoTagState.kind === 'running'
              ? `Tagge ${autoTagState.taggedTotal}/${autoTagState.requested}…`
              : `🪄 Auto-Tag (${untaggedUris.length})`}
          </button>
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

      <datalist id="library-mood-vocab">
        {moodVocab.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <datalist id="library-genre-vocab">
        {genreVocab.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-md border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Cover</th>
              <th className="px-3 py-2">Title / Artist</th>
              <th className="px-3 py-2">Dauer</th>
              <th className="px-3 py-2">BPM</th>
              <th className="px-3 py-2">Genres</th>
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
                onAddMood={addMoodTag}
                onRemoveMood={removeMoodTag}
                onAddGenre={addGenre}
                onRemoveGenre={removeGenre}
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

function AutoTagStatusBadge({ state }: { state: AutoTagState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    const pct =
      state.totalBatches > 0
        ? Math.round((state.batchIndex / state.totalBatches) * 100)
        : 0;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-sky-300">
          Auto-Tag: {state.taggedTotal}/{state.requested} Tracks
          {state.totalBatches > 0
            ? ` · Batch ${state.batchIndex}/${state.totalBatches}`
            : ' · Setup…'}
        </span>
        <div
          aria-hidden
          className="h-1 w-48 overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            // eslint-disable-next-line react/forbid-dom-props
            style={{ width: `${pct}%` }}
            className="h-full bg-sky-500 transition-[width] duration-200"
          />
        </div>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="text-xs text-red-400" title={state.message}>
        Auto-Tag-Fehler: {state.message}
      </span>
    );
  }
  // done
  const partial = state.tagged < state.requested;
  return (
    <span
      className={`text-xs ${partial ? 'text-amber-300' : 'text-emerald-300'}`}
      title={state.errors.join('\n') || undefined}
    >
      Auto-Tag: {state.tagged}/{state.requested} getaggt
      {partial && state.errors.length > 0 && ` (${state.errors.length} Fehler)`}
      {' — review + speichern'}
    </span>
  );
}

function TrackRow({
  track,
  onAddMood,
  onRemoveMood,
  onAddGenre,
  onRemoveGenre,
  onUpdate,
  onRemove,
}: {
  track: LibraryTrack;
  onAddMood: (uri: string, tag: string) => void;
  onRemoveMood: (uri: string, tag: string) => void;
  onAddGenre: (uri: string, g: string) => void;
  onRemoveGenre: (uri: string, g: string) => void;
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
        <FreeFormTagCell
          tags={track.spotifyGenres}
          datalistId="library-genre-vocab"
          placeholder="+ Genre"
          chipClass="bg-zinc-800 text-zinc-300"
          onAdd={(g) => onAddGenre(track.uri, g)}
          onRemove={(g) => onRemoveGenre(track.uri, g)}
        />
      </td>
      <td className="px-3 py-3">
        <FreeFormTagCell
          tags={track.moodTags}
          datalistId="library-mood-vocab"
          placeholder="+ Mood-Tag"
          chipClass="bg-purple-600 text-white"
          onAdd={(t) => onAddMood(track.uri, t)}
          onRemove={(t) => onRemoveMood(track.uri, t)}
        />
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

function FreeFormTagCell({
  tags,
  datalistId,
  placeholder,
  chipClass,
  onAdd,
  onRemove,
}: {
  tags: string[];
  datalistId: string;
  placeholder: string;
  chipClass: string;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft('');
  };
  return (
    <div className="flex max-w-xs flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${chipClass}`}
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(tag)}
            className="rounded text-current/80 hover:text-current"
            title={`"${tag}" entfernen`}
            aria-label={`"${tag}" entfernen`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            e.preventDefault();
            onRemove(tags[tags.length - 1]);
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-w-[6rem] flex-1 rounded bg-zinc-800/60 px-1.5 py-0.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:bg-zinc-800 focus:outline-none"
      />
    </div>
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
