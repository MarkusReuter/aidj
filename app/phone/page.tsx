'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { MOCK_PLAYLISTS } from '@/lib/mock-data';
import { useServerState } from '@/lib/use-server-state';
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
import PlaylistModal from '@/components/PlaylistModal';
import AntiButtons from '@/components/AntiButtons';

type CSSVarStyle = CSSProperties & Record<'--bpm', string>;

// Echte Such-Funktion (Phase 3a): trifft den /api/search-Proxy, der Library
// + Spotify zusammenführt. Robust gegen Netzfehler — bei Fehlern leeres Result,
// die SearchAutocomplete-UI rendert dann "Keine Treffer".
async function liveSearch(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&scope=all`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: SearchResult[] };
    return body.results ?? [];
  } catch {
    return [];
  }
}

export default function PhonePage() {
  const guestId = useGuestId();
  const {
    name: guestName,
    isCustom: guestNameIsCustom,
    setName: setGuestName,
    resetName: resetGuestName,
  } = useGuestName(guestId);

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
    guestQueue,
    mySubmission,
    onCandidateTap,
    onMoodPress,
    onPlaylistToggle,
    onSkip,
    onDislike,
    onLove,
    submitGuestTrack,
  } = useServerState({
    mode: 'guest',
    guestId,
    guestName: guestName ?? 'Gast',
  });

  const { isDj, registerTap } = useDjMode();
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

  // SnapshotGuestEntry → UI-Eintrags-Shape. `isMine` markiert den eigenen
  // Eintrag visuell (ring) in der Liste.
  const queueEntries = useMemo<GuestQueueEntry[]>(() => {
    return guestQueue.map((e) => ({
      id: e.submissionId,
      title: e.trackMeta.title,
      artist: e.trackMeta.artist,
      coverUrl: e.trackMeta.coverUrl,
      guestLabel: e.guestName,
      isMine: e.guestId === guestId,
    }));
  }, [guestQueue, guestId]);

  const slotStatus = useMemo(() => {
    if (!mySubmission) return { kind: 'free' as const };
    const position =
      guestQueue
        .filter((e) => e.status !== 'done')
        .findIndex((e) => e.submissionId === mySubmission.submissionId) + 1;
    return { kind: 'queued' as const, position: Math.max(1, position) };
  }, [mySubmission, guestQueue]);

  const handleSearchPick = useCallback(
    async (result: SearchResult) => {
      if (mySubmission) return;
      await submitGuestTrack(result.id, {
        title: result.title,
        artist: result.artist,
        coverUrl: result.coverUrl,
        // SearchResult führt heute kein durationMs — bis Phase 3a fallback
        // auf 0 (UI hat keine Anzeige darauf). Server validiert positive int,
        // also nehmen wir 1ms als Platzhalter.
        durationMs: 1,
      });
    },
    [mySubmission, submitGuestTrack],
  );

  if (!currentTrack || !currentQuestion) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 bg-black px-6 text-center text-zinc-400">
        {!spotifyConnected ? (
          <>
            <p className="text-xl text-zinc-300">Spotify nicht verbunden</p>
            <p className="text-sm">Der Host muss am Mac den Login-Flow durchlaufen.</p>
          </>
        ) : !currentTrack ? (
          <>
            <p className="text-xl text-zinc-300">Gerade läuft nichts</p>
            <p className="text-sm">Warte, bis der Host einen Track startet.</p>
          </>
        ) : (
          <p>Verbinde...</p>
        )}
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
    <>
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
        onTap={mySubmission ? () => {} : onCandidateTap}
      />

      <SearchAutocomplete
        searchFn={liveSearch}
        onPick={handleSearchPick}
        disabled={Boolean(mySubmission)}
        disabledHint={
          mySubmission ? 'Du hast schon einen Track in der Queue.' : undefined
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
          <AntiButtons
            onSkip={onSkip}
            onDislike={onDislike}
            onLove={onLove}
            onOpenPlaylists={() => setPlaylistModalOpen(true)}
            activePlaylistCount={activePlaylists.size}
            toast={toast}
          />
        </>
      )}
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
