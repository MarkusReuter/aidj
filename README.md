# AIDJ — Party-DJ Tablet App

Ein touch-only Tablet-Frontend, das Claude als DJ-Vorauswahl mit Spotify Connect als Playback verbindet. Crowd liest sich selbst: Gäste tippen auf einem iPad an der Bar Track-Karten, Mood-Buttons und Playlist-Filter — Claude wählt daraus laufend die nächsten Tracks und schiebt sie in die Spotify-Queue.

Vollständige Architektur, Phasenplan und Begründungen siehe [PLAN.md](./PLAN.md).

## Status

Phase 1 (Tablet-UI-Demo mit Mock-Daten) ist im Aufbau. Spotify- und Claude-Integration kommen in späteren Phasen.

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

App öffnen unter [http://localhost:3000/tablet](http://localhost:3000/tablet).

Aufs iPad (gleiches WLAN): `http://<mac-lan-ip>:3000/tablet` → "Zum Home-Bildschirm hinzufügen" für Fullscreen-PWA.

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
  tablet/        Tablet-Frontend (touch-only)
components/      React-Komponenten (NowPlayingBar, NextUpCandidates, …)
lib/             Mock-Daten heute, Spotify/DJ-Brain später
data/            Statische Library + Mock-Covers
scripts/         Einmal-Tools (Cover-Fetch, später Library-Builder)
public/          PWA-Manifest, Icons
PLAN.md          Vollständiger Implementationsplan
AGENTS.md        Hinweise für AI-Coding-Agents (Next.js-Version-Warnung)
CLAUDE.md        Onboarding für Claude Code im Repo
```

## Hinweis für AI-Agents

Diese Codebase nutzt eine Next.js-Version mit Breaking Changes gegenüber dem, was die meisten Modelle trainiert haben. Vor dem Editieren: [AGENTS.md](./AGENTS.md) und [CLAUDE.md](./CLAUDE.md) lesen.
