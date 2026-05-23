'use client';

import type { CSSProperties } from 'react';
import { MOCK_PLAYLISTS } from '@/lib/mock-data';
import { useMockLoop } from '@/lib/mock-loop';
import NowPlayingBar from '@/components/NowPlayingBar';
import NextUpCandidates from '@/components/NextUpCandidates';
import MoodSection from '@/components/MoodSection';
import PlaylistToggles from '@/components/PlaylistToggles';
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
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
  } = useMockLoop();

  useFullscreenOnTap();
  useScreenWakeLock();

  if (!currentTrack || !currentQuestion) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        <p>Lade Mock-Daten...</p>
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

      <div className="flex h-[42%] flex-none flex-col gap-2">
        <MoodSection
          question={currentQuestion}
          counts={moodCounts}
          onPress={onMoodPress}
        />

        <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <PlaylistToggles
            playlists={MOCK_PLAYLISTS}
            active={activePlaylists}
            onToggle={onPlaylistToggle}
          />
          <AntiButtons
            onSkip={onSkip}
            onDislike={onDislike}
            onLove={onLove}
            toast={toast}
          />
        </section>
      </div>
    </main>
  );
}
