# AIDJ — Party-DJ Tablet App

Ein touch-only Tablet-Frontend, das Claude als DJ-Vorauswahl mit Spotify Connect als Playback verbindet. Crowd liest sich selbst: Gäste tippen auf einem iPad an der Bar Track-Karten, Mood-Buttons und Playlist-Filter — Claude wählt daraus laufend die nächsten Tracks und schiebt sie in die Spotify-Queue.

Vollständige Architektur, Phasenplan und Begründungen siehe [PLAN.md](./PLAN.md).

## Status

- ✓ Phase 1: Tablet-UI mit Mock-Daten, vollständig durchklickbar.
- ✓ Phase 1a: Phone-UI mit UA-Routing, Gast-Slot + Track-Suche, Hidden-DJ-Mode (10× Tap aufs Logo).
- ✓ Phase 2: `data/library.json` + Editor unter `/admin` (Mood-Tags + Energy), `build-library`-Skript für Spotify+GetSongBPM-Ingest.
- ↻ Phase 3: Spotify-OAuth + Queue-Control + SSE — noch offen.
- ↻ Phase 5: Claude-DJ-Brain — noch offen.

## Stack

- **Next.js 16** (App Router, TypeScript) — lokales Backend + iPad-Frontend in einem Repo
- **Tailwind CSS 4** — große Touch-Targets, Dark Mode
- **Zod** — Schemas für Mock-Daten und (später) LLM-Output
- _geplant ab Phase 3:_ `@spotify/web-api-ts-sdk`
- _geplant ab Phase 5:_ `ai` + `@ai-sdk/anthropic` (Vercel AI SDK)

## Setup

```bash
npm install
npm run dev
```

App öffnen unter [http://localhost:3000/](http://localhost:3000/) — UA-Sniff routet Desktop/Tablet auf `/tablet`, Phone auf `/phone`.

Aufs iPad (gleiches WLAN): `http://<mac-lan-ip>:3000/` → "Zum Home-Bildschirm hinzufügen" für Fullscreen-PWA.

Library-Editor am Mac: [http://localhost:3000/admin](http://localhost:3000/admin) — Mood-Tags und Energy pro Track setzen, speichert direkt in `data/library.json`.

Library aus echten Spotify-Playlists bauen (braucht `.env.local` mit `SPOTIFY_CLIENT_ID`/`SECRET`, optional `GETSONGBPM_API_KEY`):

```bash
npm run build-library -- spotify:playlist:abc123 spotify:playlist:def456
```

Vorhandene Mood-Tags + Energy bleiben pro Track-URI beim Re-Build erhalten.

## Environment

Ab Phase 3 / 5 wird eine `.env.local` benötigt. Diese Datei ist über `.gitignore` ausgeschlossen und **darf nie committed werden**:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/spotify/callback
ANTHROPIC_API_KEY=...
```

Spotify-Account, mit dem sich die App authentifiziert, **muss Premium** sein — Queue-Control ist Premium-only.

## Struktur

```
app/             Next.js App Router (UI + API Routes)
  tablet/        Tablet-Frontend (touch-only, Landscape)
  phone/         Phone-Frontend (Portrait, Gast + Hidden-DJ-Mode)
  admin/         Library-Editor am Mac
  api/           lan-url, library; Spotify/SSE-Routen folgen ab Phase 3/4
components/      Geteilte Touch-Komponenten + phone/-Untermodule
lib/             mock-data, mock-loop, library-schema (Zod), library (fs),
                 phone/ (guest-id, guest-name, dj-mode);
                 Spotify-/DJ-Brain-Module folgen ab Phase 3/5
data/            mock-covers.json, library.json (kuratierte Track-Library)
scripts/         fetch-mock-covers.ts, build-library.ts
public/          PWA-Manifest, Icons
PLAN.md          Vollständiger Implementationsplan
AGENTS.md        Hinweise für AI-Coding-Agents (Next.js-Version-Warnung)
CLAUDE.md        Onboarding für Claude Code im Repo
```

## Hinweis für AI-Agents

Diese Codebase nutzt eine Next.js-Version mit Breaking Changes gegenüber dem, was die meisten Modelle trainiert haben. Vor dem Editieren: [AGENTS.md](./AGENTS.md) und [CLAUDE.md](./CLAUDE.md) lesen.
