@AGENTS.md

# AIDJ — Repo-Onboarding für Claude Code

Touch-only Tablet-App für Partys: Claude wählt Tracks vor, Crowd tippt auf iPad-Karten, Spotify Connect spielt ab. Voller Architektur- und Phasenplan steht in [PLAN.md](./PLAN.md) — lies den, bevor du nicht-triviale Änderungen machst.

## Heutiger Stand

Phase 1 (Tablet-UI), Phase 1a (Phone-UI + UA-Routing + DJ-Mode), Phase 2 (Library-Editor + `build-library`-Skript), Phase 3 (Spotify-OAuth + Proxy) und Phase 4 (Server-State + SSE-Pipeline) sind durch. Tablet/Phone hängen an `lib/state.ts` (5-s-Spotify-Polling, EventEmitter-Pub-Sub, Multi-Client-Sync); Kandidaten kommen zufällig aus `data/library.json` als Stand-in für den DJ-Brain. Tap auf eine Kandidaten-Karte queued den Track tatsächlich in Spotify (`/api/queue/commit`). Phase 4a (Gast-Queue-Server-State) und Phase 5 (Claude-DJ-Brain + Lock-Window + echter Skip) sind **noch nicht** verdrahtet.

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
  api/
    lan-url/     LAN-IP-Detection für QR-Code
    library/     Library load/save
    spotify/     OAuth (auth, callback) + Proxy (devices, select-device, queue, now-playing)
    state/       stream (SSE) + button (mood/playlist/anti)
    queue/       commit (Candidate-Tap → Spotify Queue + committedId)
components/      NowPlayingBar, NextUpCandidates, MoodSection, PlaylistModal, AntiButtons, WifiQrCode
  phone/         PhoneTopBar, NowPlayingCard, HeartbeatBadge, GuestQueueList, …
lib/             mock-data.ts (15 Mock-Tracks + Mood-Fragen)
                 library-schema.ts (Zod, Client-Safe) + library.ts (fs-Wrapper, Server-Only)
                 spotify.ts (Token-Storage in ~/.aidj-app/ + Wrapper, Server-Only)
                 state.ts (Party-State-Singleton + EventEmitter + 5s-Polling, Server-Only)
                 server-state-types.ts (SSE-Wire-Format, Client-Safe)
                 use-server-state.ts ('use client'-Hook auf EventSource)
                 phone/ (guest-id, guest-name, dj-mode)
                 → dj-brain.ts kommt in Phase 5
data/            mock-covers.json, library.json (kuratierte Track-Library für DJ-Brain)
scripts/         fetch-mock-covers.ts, build-library.ts
public/          PWA-Manifest, Icons
```

## Next.js-Version

Diese Version hat Breaking Changes gegenüber Training-Daten — siehe AGENTS.md. Bevor du eine Next.js-API benutzt, die du "kennst", check `node_modules/next/dist/docs/` oder das aktuelle Verhalten im Code.
