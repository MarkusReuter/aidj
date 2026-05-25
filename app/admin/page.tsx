import { loadLibrary } from '@/lib/library';
import {
  getMe,
  hasScope,
  isConnected,
  SpotifyNotConnectedError,
} from '@/lib/spotify';
import BrainStatus from './BrainStatus';
import ConnectionStatus from './ConnectionStatus';
import LibraryEditor from './LibraryEditor';
import PlaylistPicker from './PlaylistPicker';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'AIDJ — Library Editor',
};

type SpotifyStatus = {
  connected: boolean;
  hasPlaylistScope: boolean;
  user: { id: string; displayName: string | null } | null;
};

async function getSpotifyStatus(): Promise<SpotifyStatus> {
  if (!(await isConnected())) {
    return { connected: false, hasPlaylistScope: false, user: null };
  }
  try {
    const playlistScope = await hasScope('playlist-read-private');
    let user: SpotifyStatus['user'] = null;
    if (playlistScope) {
      const me = await getMe();
      user = { id: me.id, displayName: me.displayName };
    }
    return { connected: true, hasPlaylistScope: playlistScope, user };
  } catch (err) {
    if (err instanceof SpotifyNotConnectedError) {
      return { connected: false, hasPlaylistScope: false, user: null };
    }
    // Token vorhanden, aber Spotify lehnt ab (revoked, Netz-Fehler, …) — als
    // "verbunden ohne Scope" anzeigen, damit der Reconnect-Banner kommt.
    return { connected: true, hasPlaylistScope: false, user: null };
  }
}

export default async function AdminPage() {
  const [library, spotifyStatus] = await Promise.all([
    loadLibrary(),
    getSpotifyStatus(),
  ]);
  // Key-Bump auf `builtAt`: nach einem Library-Build aktualisiert
  // `router.refresh()` aus dem PlaylistPicker die Server-Component, der neue
  // Timestamp bumpt den Key, React unmount/remount → der Editor sieht die
  // neuen Tracks frisch im `useState`-Initialwert.
  const editorKey = library.builtAt ?? 'empty';
  return (
    <main className="mx-auto max-w-7xl p-6">
      <ConnectionStatus status={spotifyStatus} />
      <BrainStatus />
      {spotifyStatus.connected && spotifyStatus.hasPlaylistScope && (
        <PlaylistPicker />
      )}
      <LibraryEditor key={editorKey} initialLibrary={library} />
    </main>
  );
}
