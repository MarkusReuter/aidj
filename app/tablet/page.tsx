'use client';

import { useState, type CSSProperties } from 'react';
import { MOCK_PLAYLISTS } from '@/lib/mock-data';
import { useServerState } from '@/lib/use-server-state';
import NowPlayingBar from '@/components/NowPlayingBar';
import NextUpCandidates from '@/components/NextUpCandidates';
import MoodSection from '@/components/MoodSection';
import PlaylistModal from '@/components/PlaylistModal';
import AntiButtons from '@/components/AntiButtons';
import WifiQrCode from '@/components/WifiQrCode';
import {
  useFullscreenOnTap,
  useScreenWakeLock,
} from '@/lib/use-tablet-features';

type CSSVarStyle = CSSProperties & Record<'--bpm', string>;

export default function TabletPage() {
  const {
    currentTrack,
    candidates,
    committedId,
    progressMs,
    moodCounts,
    activePlaylists,
    currentQuestion,
    autoPickInSec,
    toast,
    spotifyConnected,
    deviceName,
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
  } = useServerState();

  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

  useFullscreenOnTap();
  useScreenWakeLock();

  if (!currentTrack || !currentQuestion) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center text-zinc-400">
        {!spotifyConnected ? (
          <>
            <p className="text-xl text-zinc-300">Spotify nicht verbunden</p>
            <p className="text-sm">
              Öffne am Mac{' '}
              <a
                href="/api/spotify/auth"
                className="text-purple-400 underline"
              >
                /api/spotify/auth
              </a>{' '}
              und durchlaufe den Login-Flow.
            </p>
          </>
        ) : !currentTrack ? (
          <>
            <p className="text-xl text-zinc-300">Spotify spielt gerade nichts</p>
            <p className="text-sm">
              Starte einen ersten Track in der Spotify-App
              {deviceName ? ` (Device: ${deviceName})` : ''}, danach übernimmt
              die Crowd.
            </p>
          </>
        ) : (
          <p>Lade Snapshot...</p>
        )}
      </main>
    );
  }

  const bpmStyle: CSSVarStyle = {
    '--bpm': String(currentTrack.bpm),
    paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
    paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
    paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
    paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
  };

  return (
    <>
      <main
        style={bpmStyle}
        className="flex h-dvh flex-col gap-2 overflow-hidden bg-black text-zinc-100 font-sans"
      >
        <div className="flex flex-none items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <NowPlayingBar track={currentTrack} progressMs={progressMs} />
          </div>
          <WifiQrCode />
        </div>

        <NextUpCandidates
          candidates={candidates}
          committedId={committedId}
          autoPickInSec={autoPickInSec}
          onTap={onCandidateTap}
        />

        <div className="flex flex-none flex-col gap-2">
          <MoodSection
            question={currentQuestion}
            counts={moodCounts}
            onPress={onMoodPress}
          />

          <AntiButtons
            onSkip={onSkip}
            onDislike={onDislike}
            onLove={onLove}
            onOpenPlaylists={() => setPlaylistModalOpen(true)}
            activePlaylistCount={activePlaylists.size}
            toast={toast}
          />
        </div>
      </main>

      <PlaylistModal
        playlists={MOCK_PLAYLISTS}
        active={activePlaylists}
        onToggle={onPlaylistToggle}
        open={playlistModalOpen}
        onClose={() => setPlaylistModalOpen(false)}
      />
    </>
  );
}
