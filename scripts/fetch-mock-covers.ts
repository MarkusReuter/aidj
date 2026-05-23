/**
 * fetch-mock-covers.ts
 *
 * Pure Node script (run via `npx tsx scripts/fetch-mock-covers.ts`).
 * For each of the hardcoded mock tracks, this queries the public iTunes Search
 * API and grabs the album artwork URL (upgraded from 100x100 -> 600x600).
 * The resulting `{ id: artworkUrl }` map is written to `data/mock-covers.json`.
 *
 * No external dependencies — uses Node's built-in global `fetch`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type MockTrackSeed = {
  id: string;
  artist: string;
  title: string;
};

type ITunesSearchResult = {
  resultCount: number;
  results: Array<{
    artworkUrl100?: string;
  }>;
};

const TRACKS: ReadonlyArray<MockTrackSeed> = [
  // House / Electronic
  { id: "mock-1", artist: "deadmau5", title: "Strobe" },
  { id: "mock-2", artist: "Daft Punk", title: "One More Time" },
  { id: "mock-3", artist: "Calvin Harris", title: "Summer" },
  // Hip-Hop
  { id: "mock-4", artist: "Dr. Dre", title: "Still D.R.E." },
  { id: "mock-5", artist: "Kendrick Lamar", title: "HUMBLE." },
  { id: "mock-6", artist: "Cardi B", title: "Bodak Yellow" },
  // 80s
  { id: "mock-7", artist: "a-ha", title: "Take On Me" },
  { id: "mock-8", artist: "Michael Jackson", title: "Billie Jean" },
  // Indie
  { id: "mock-9", artist: "Arctic Monkeys", title: "Do I Wanna Know?" },
  { id: "mock-10", artist: "Tame Impala", title: "The Less I Know The Better" },
  // Latin
  { id: "mock-11", artist: "Bad Bunny", title: "Tití Me Preguntó" },
  { id: "mock-12", artist: "Shakira", title: "Hips Don't Lie" },
  // Rock
  { id: "mock-13", artist: "Queen", title: "Don't Stop Me Now" },
  // Pop
  { id: "mock-14", artist: "Dua Lipa", title: "Don't Start Now" },
  { id: "mock-15", artist: "The Weeknd", title: "Blinding Lights" },
];

const DELAY_MS = 200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCover(track: MockTrackSeed): Promise<string | null> {
  const query = encodeURIComponent(`${track.artist} ${track.title}`);
  const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[${track.id}] iTunes returned ${res.status} for "${track.artist} - ${track.title}"`,
      );
      return null;
    }

    const data = (await res.json()) as ITunesSearchResult;
    const artwork = data.results[0]?.artworkUrl100;
    if (!artwork) {
      console.warn(
        `[${track.id}] No artwork found for "${track.artist} - ${track.title}"`,
      );
      return null;
    }

    return artwork.replace("100x100bb.jpg", "600x600bb.jpg");
  } catch (err) {
    console.warn(
      `[${track.id}] Fetch failed for "${track.artist} - ${track.title}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function main(): Promise<void> {
  // Resolve paths relative to the repo root (one level above scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const dataDir = join(repoRoot, "data");
  const outputPath = join(dataDir, "mock-covers.json");

  await mkdir(dataDir, { recursive: true });

  const covers: Record<string, string | null> = {};
  let successCount = 0;

  for (const track of TRACKS) {
    const cover = await fetchCover(track);
    covers[track.id] = cover;
    if (cover !== null) successCount += 1;
    console.log(
      `[${track.id}] ${track.artist} - ${track.title}: ${cover ? "OK" : "MISSING"}`,
    );
    await sleep(DELAY_MS);
  }

  await writeFile(outputPath, JSON.stringify(covers, null, 2) + "\n", "utf8");

  console.log(
    `\nWrote ${outputPath} — ${successCount}/${TRACKS.length} covers fetched.`,
  );

  if (successCount < TRACKS.length) {
    console.warn(
      `Note: ${TRACKS.length - successCount} cover(s) missing; the app will fall back to a placeholder.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("fetch-mock-covers failed:", err);
  process.exit(1);
});
