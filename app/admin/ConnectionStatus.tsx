type Status = {
  connected: boolean;
  hasPlaylistScope: boolean;
  user: { id: string; displayName: string | null } | null;
};

type Props = {
  status: Status;
};

/**
 * Banner ganz oben in /admin: zeigt Spotify-Verbindungsstatus. Server-Component,
 * Status wird in `app/admin/page.tsx` server-seitig geholt (single round-trip).
 *
 * Drei Zustände:
 *   - voll verbunden + Scope OK         → grüner Pill
 *   - verbunden, aber neuer Scope fehlt → orangener Banner mit Re-Auth-Link
 *   - gar nicht verbunden               → roter Banner mit Connect-Link
 */
export default function ConnectionStatus({ status }: Props) {
  if (status.connected && status.hasPlaylistScope && status.user) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-900/50 bg-emerald-950/30 px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <span aria-hidden>●</span>
          <span>
            Spotify verbunden als{' '}
            <strong>{status.user.displayName ?? status.user.id}</strong>
          </span>
        </div>
        <a
          href="/api/spotify/auth"
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Account wechseln / neu verbinden"
        >
          neu verbinden
        </a>
      </div>
    );
  }

  if (status.connected && !status.hasPlaylistScope) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-900/50 bg-amber-950/30 px-4 py-2">
        <p className="text-sm text-amber-200">
          Spotify ist verbunden, aber der neue <code>playlist-read-private</code>
          -Scope fehlt — bitte neu verbinden, damit die Playlist-Liste geladen
          werden kann.
        </p>
        <a
          href="/api/spotify/auth"
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500"
        >
          Spotify neu verbinden
        </a>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-900/50 bg-red-950/30 px-4 py-2">
      <p className="text-sm text-red-300">
        Spotify ist <strong>nicht verbunden</strong> — der Library-Build und
        DJ-Brain brauchen einen Account. Token liegt server-seitig in{' '}
        <code>~/.aidj-app/token.json</code>; ein Login gilt für alle Browser am
        Mac.
      </p>
      <a
        href="/api/spotify/auth"
        className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500"
      >
        Spotify verbinden
      </a>
    </div>
  );
}
