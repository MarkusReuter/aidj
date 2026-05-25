@AGENTS.md

# AIDJ — Repo-Onboarding für Claude Code

Touch-only Tablet-App für Partys: Claude wählt Tracks vor, Crowd tippt auf iPad-Karten, Spotify Connect spielt ab. Voller Architektur- und Phasenplan steht in [PLAN.md](./PLAN.md) — lies den, bevor du nicht-triviale Änderungen machst.

## Heutiger Stand

Phase 1 (Tablet-UI), Phase 1a (Phone-UI + UA-Routing + DJ-Mode) und Phase 2 (Library-Editor + `build-library`-Skript) sind durch. `data/library.json` existiert als Mock-Library aus den 15 MOCK_TRACKS — der Editor unter `/admin` funktioniert ohne API-Keys gegen diese Demo-Library. Spotify-OAuth (Phase 3) und Claude-DJ-Brain (Phase 5) sind **noch nicht** verdrahtet. `.env.local` ist nicht angelegt; `build-library` läuft erst wenn Spotify-Credentials da sind.

## Liefer-Reihenfolge (wichtig)

Demo-First. Reihenfolge laut PLAN.md:
1. Tablet-UI komplett durchklickbar mit Mock-Daten — muss sich in der Hand wie das Endprodukt anfühlen.
2. Spotify-Integration (OAuth, Queue, Now-Playing-Polling, SSE).
3. Claude-DJ-Brain ersetzt Mock-Kandidaten durch echte LLM-Vorschläge.

Bau keine Phase 3/5-Features in Phase-1-Code rein. Wenn etwas einen API-Key bräuchte, ist es zu früh.

## Harte Regeln

- **Keine Texteingabe im Tablet-UI.** Keine `<input>`, keine `<textarea>`, keine Suchleiste, kein Volume-Slider, kein Login auf dem iPad. Alles wird vorher am Mac gesetzt.
- **iPad-Ziel-Layout: Landscape 1024×768.** Portrait-Fallback per `@media (orientation: portrait)`, aber Landscape ist primär.
- **Touch-Targets min. 120×120 px**, Kandidaten-Karten min. 200×240 px. Kein Hover-State.
- **`next start` während der Party, nicht `next dev`** — State liegt nur im Memory, HMR würde ihn wegwerfen.
- **Spotify-Account muss Premium sein** — Queue-Control ist Premium-only. Mit Free läuft die App nicht.

## Secrets

`.env.local` ist über `.gitignore` ausgeschlossen. **Nie committen.** Erwartete Variablen (ab Phase 3/5):
```
SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, ANTHROPIC_API_KEY
```
Spotify-Refresh-Token wird in `~/.aidj-app/token.json` mit `chmod 0600` gespeichert — nicht im Repo.

## Dev

```bash
npm install
npm run dev            # http://localhost:3000  (Root sniffed UA → /tablet oder /phone)
npm run build          # Produktion (vor der Party)
npm start              # Produktions-Server, State persistiert über Lifetime des Prozesses
npm run build-library -- <playlist-uri> [<playlist-uri> ...]
                       # Einmal pro Party: Library aus Spotify-Playlists bauen.
                       # Braucht SPOTIFY_CLIENT_ID/SECRET in .env.local; GETSONGBPM_API_KEY optional.
```

## Codebase-Layout

```
app/             Root-Page (UA-Sniff → /tablet | /phone) + Layout
  tablet/        Tablet-Frontend (das, was auf dem iPad läuft)
  phone/         Phone-Frontend (Portrait, User-Mode + DJ-Mode-Hidden-Tap-Unlock)
  admin/         Library-Editor am Mac (Mood-Tags + Energy taggen)
  api/           Server-Routen (lan-url, library; Spotify-Proxy + SSE ab Phase 3/4)
components/      NowPlayingBar, NextUpCandidates, MoodSection, PlaylistModal, AntiButtons, WifiQrCode
  phone/         PhoneTopBar, NowPlayingCard, HeartbeatBadge, GuestQueueList, …
lib/             mock-data.ts + mock-loop.ts (Tablet+Phone Shared-State, Demo-Loop)
                 library-schema.ts (Zod, Client-Safe) + library.ts (fs-Wrapper, Server-Only)
                 phone/ (guest-id, guest-name, dj-mode)
                 → spotify.ts, dj-brain.ts, state.ts kommen in Phase 3-5
data/            mock-covers.json, library.json (kuratierte Track-Library für DJ-Brain)
scripts/         fetch-mock-covers.ts, build-library.ts
public/          PWA-Manifest, Icons
```

## Next.js-Version

Diese Version hat Breaking Changes gegenüber Training-Daten — siehe AGENTS.md. Bevor du eine Next.js-API benutzt, die du "kennst", check `node_modules/next/dist/docs/` oder das aktuelle Verhalten im Code.
