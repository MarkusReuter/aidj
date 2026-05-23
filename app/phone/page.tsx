'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { MOCK_PLAYLISTS, MOCK_TRACKS, type Track } from '@/lib/mock-data';
import { useMockLoop } from '@/lib/mock-loop';
import { useDjMode } from '@/lib/phone/dj-mode';
import { useGuestId } from '@/lib/phone/guest-id';
import { useGuestName } from '@/lib/phone/guest-name';
import PhoneTopBar from '@/components/phone/PhoneTopBar';
import NowPlayingCard from '@/components/phone/NowPlayingCard';
import HeartbeatBadge from '@/components/phone/HeartbeatBadge';
import GuestStatusBadge from '@/components/phone/GuestStatusBadge';
import GuestNameEditor from '@/components/phone/GuestNameEditor';
import PhoneCandidates from '@/components/phone/PhoneCandidates';
import SearchAutocomplete, {
  type SearchResult,
} from '@/components/phone/SearchAutocomplete';
import GuestQueueList, {
  type GuestQueueEntry,
} from '@/components/phone/GuestQueueList';
import MoodSection from '@/components/MoodSection';
import PlaylistToggles from '@/components/PlaylistToggles';
import AntiButtons from '@/components/AntiButtons';

type CSSVarStyle = CSSProperties & Record<'--bpm', string>;

// Two seed entries so the queue isn't empty at first render (demo requirement
// from PLAN.md Phase 1a).
const SEED_QUEUE: GuestQueueEntry[] = [
  {
    id: 'seed-1',
    title: 'Insomnia',
    artist: 'Faithless',
    coverUrl: MOCK_TRACKS[7]?.coverUrl ?? '',
    guestLabel: 'Anna',
    isMine: false,
  },
  {
    id: 'seed-2',
    title: 'Around the World',
    artist: 'Daft Punk',
    coverUrl: MOCK_TRACKS[1]?.coverUrl ?? '',
    guestLabel: 'Tim',
    isMine: false,
  },
];

function trackToSearchResult(
  track: Track,
  source: 'playlist' | 'spotify',
): SearchResult {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    coverUrl: track.coverUrl,
    source,
  };
}

// Mock search: substring-match across MOCK_TRACKS. First half is tagged as
// playlist, second half as spotify, just so the source-pill visibly differs.
async function mockSearch(query: string): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  const matches = MOCK_TRACKS.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q),
  );
  return matches.map((t, idx) =>
    trackToSearchResult(t, idx % 2 === 0 ? 'playlist' : 'spotify'),
  );
}

export default function PhonePage() {
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

  const { isDj, registerTap } = useDjMode();
  const guestId = useGuestId();
  const {
    name: guestName,
    isCustom: guestNameIsCustom,
    setName: setGuestName,
    resetName: resetGuestName,
  } = useGuestName(guestId);
  const [guestSubmission, setGuestSubmission] =
    useState<GuestQueueEntry | null>(null);

  const queueEntries = useMemo<GuestQueueEntry[]>(() => {
    if (!guestSubmission) return SEED_QUEUE;
    return [...SEED_QUEUE, guestSubmission];
  }, [guestSubmission]);

  const slotStatus = guestSubmission
    ? {
        kind: 'queued' as const,
        position: queueEntries.findIndex((e) => e.isMine) + 1,
      }
    : { kind: 'free' as const };

  const handleCandidateTapWithQuota = useCallback(
    (id: string) => {
      if (guestSubmission) return;
      const track = MOCK_TRACKS.find((t) => t.id === id);
      if (!track) return;
      onCandidateTap(id);
      setGuestSubmission({
        id: `guest-${guestId ?? 'anon'}-${id}`,
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        guestLabel: guestName ?? 'du',
        isMine: true,
      });
    },
    [guestSubmission, guestId, guestName, onCandidateTap],
  );

  const handleSearchPick = useCallback(
    (result: SearchResult) => {
      if (guestSubmission) return;
      setGuestSubmission({
        id: `guest-${guestId ?? 'anon'}-${result.id}`,
        title: result.title,
        artist: result.artist,
        coverUrl: result.coverUrl,
        guestLabel: guestName ?? 'du',
        isMine: true,
      });
    },
    [guestSubmission, guestId, guestName],
  );

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
    paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
    paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
    paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
  };

  return (
    <main
      style={bpmStyle}
      className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 bg-black text-zinc-100 font-sans"
    >
      <PhoneTopBar
        isDj={isDj}
        onLogoTap={registerTap}
        statusBadge={<GuestStatusBadge status={slotStatus} />}
      />

      <div className="px-1">
        <GuestNameEditor
          name={guestName}
          isCustom={guestNameIsCustom}
          onSave={setGuestName}
          onReset={resetGuestName}
        />
      </div>

      <NowPlayingCard track={currentTrack} progressMs={progressMs} />

      <HeartbeatBadge moodCounts={moodCounts} />

      <PhoneCandidates
        candidates={candidates}
        committedId={committedId}
        autoPickInSec={autoPickInSec}
        onTap={handleCandidateTapWithQuota}
      />

      <SearchAutocomplete
        searchFn={mockSearch}
        onPick={handleSearchPick}
        disabled={Boolean(guestSubmission)}
        disabledHint={
          guestSubmission
            ? 'Du hast schon einen Track in der Queue.'
            : undefined
        }
      />

      <GuestQueueList entries={queueEntries} />

      {isDj && (
        <>
          <MoodSection
            question={currentQuestion}
            counts={moodCounts}
            onPress={onMoodPress}
          />
          <section className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
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
        </>
      )}
    </main>
  );
}
