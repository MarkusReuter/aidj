import {
  getButtonLog,
  getPartyStartedAt,
  getPlayHistory,
} from '@/lib/state';
import { loadLibrary, type LibraryTrack } from '@/lib/library';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'AIDJ — History',
};

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 0) return '–';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function buttonLabel(
  type: 'mood' | 'playlist' | 'dislike' | 'love',
  value: string,
): string {
  switch (type) {
    case 'mood':
      return `🎚 Mood: ${value}`;
    case 'playlist':
      return `📻 Playlist: ${value}`;
    case 'dislike':
      return '👎 Nicht das';
    case 'love':
      return '❤️ Mehr davon';
  }
}

export default async function HistoryPage() {
  const [library, log, history, partyStartedAt] = await Promise.all([
    loadLibrary(),
    Promise.resolve(getButtonLog()),
    Promise.resolve(getPlayHistory()),
    Promise.resolve(getPartyStartedAt()),
  ]);
  const trackByUri = new Map<string, LibraryTrack>(
    library.tracks.map((t) => [t.uri, t]),
  );
  // Neueste zuerst — Party-Recap liest sich rückwärts wie eine Story.
  const eventsRev = [...log].reverse();
  const playedRev = [...history].reverse();
  const totals = log.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});
  const partyDurationMs =
    log.length > 0
      ? (log[log.length - 1]?.timestamp ?? Date.now()) - partyStartedAt
      : Date.now() - partyStartedAt;

  return (
    <main className="mx-auto max-w-4xl p-6 text-zinc-100">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Party-History</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Start: {fmtTime(partyStartedAt)} · Dauer: {fmtDuration(partyDurationMs)} ·{' '}
          {history.length} Tracks gespielt · {log.length} Button-Klicks
          {totals.dislike != null && ` · ${totals.dislike}× 👎`}
          {totals.love != null && ` · ${totals.love}× ❤️`}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Gespielt (neueste zuerst)
          </h2>
          {playedRev.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Noch nichts gespielt — Party läuft erst los wenn der erste Track
              auf Spotify Connect startet.
            </p>
          ) : (
            <ol className="space-y-1">
              {playedRev.map((uri, idx) => {
                const t = trackByUri.get(uri);
                return (
                  <li
                    key={`${uri}-${idx}`}
                    className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950 p-2"
                  >
                    {t?.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.coverUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-zinc-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t?.title ?? uri}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {t?.artist ?? '—'}
                        {t?.bpm != null && (
                          <span className="ml-2 text-zinc-600">{t.bpm} BPM</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Button-Klicks (neueste zuerst)
          </h2>
          {eventsRev.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Noch keine Klicks erfasst.
            </p>
          ) : (
            <ol className="max-h-[60vh] overflow-y-auto space-y-1 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
              {eventsRev.map((e, idx) => {
                const t = e.trackUri ? trackByUri.get(e.trackUri) : null;
                return (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono text-zinc-600">
                      {fmtTime(e.timestamp)}
                    </span>
                    <span className="shrink-0 text-zinc-200">
                      {buttonLabel(e.type, e.value)}
                    </span>
                    {t && (
                      <span className="ml-auto truncate text-zinc-500">
                        @ {t.title} — {t.artist}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <footer className="mt-8 text-xs text-zinc-600">
        State lebt im Memory des Node-Prozesses; ein Restart leert die History.
        Post-mortem-Dump als JSON ist out-of-scope für V1.
      </footer>
    </main>
  );
}
