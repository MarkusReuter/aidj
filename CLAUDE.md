@AGENTS.md

# AIDJ — Repo-Onboarding für Claude Code

Touch-only Tablet-App für Partys: Claude wählt Tracks vor, Crowd tippt auf iPad-Karten, Spotify Connect spielt ab. Voller Architektur- und Phasenplan steht in [PLAN.md](./PLAN.md) — lies den, bevor du nicht-triviale Änderungen machst.

## Heutiger Stand

Phasen 1, 1a, 2, 3, 3a, 4, 4a, 4b und 5 sind durch. Tablet/Phone hängen an `lib/state.ts` (5-s-Spotify-Polling, EventEmitter-Pub-Sub, Multi-Client-Sync); Kandidaten kommen vom DJ-Brain (`lib/dj-brain.ts`) — Claude via `@ai-sdk/anthropic` + `generateObject`, mit Heuristik-Fallback wenn `ANTHROPIC_API_KEY` fehlt (BPM-Match ±10, Tag-Overlap-Penalties aus 👎/❤️, History-Exclusion). Tablet-Tap committet direkt in die Spotify-Queue (`/api/queue/commit`, Host-Privileg); Phone-Tap geht durch die Gast-Queue (`/api/guest/submit`) mit FIFO + 1-Slot-Quota + Idempotenz. Track-Lifecycle (pending → playing → done) wird automatisch beim Spotify-Track-Wechsel gesetzt. Lock-Window pusht ~10 s vor Track-Ende den Auto-Pick (committed-Wahl oder Top-Kandidat) in die Spotify-Queue. Skip ist echt (`/api/state/skip` → `spotify.skipToNext()`). 👎/❤️ + Mood-Shift triggern Brain-Re-Rank. `/admin` zeigt einen Spotify-Verbindungsstatus-Banner und einen Playlist-Picker, der die Library **additiv** (bestehende Tracks bleiben, neue werden angehängt) via SSE-Stream baut. Phone-Suche trifft `/api/search` (Library + Spotify Web-Search gemerged, LRU-Cache 60s).

**Spotify-Dev-Mode-Restrictions (2025/2026)**: Mehrere Endpoints geben für non-production-Apps 403 — `/v1/playlists/{id}/tracks` (deprecated, `/items` nutzen), `/v1/artists` (Bulk, kein Workaround außer Production-Mode). Details + Liste in PLAN.md Phase 4b → "Spotify-API-Realität". Beim Anfassen neuer Spotify-Endpoints **erst live proben**, bevor man Schemas hardcodet — und `127.0.0.1` statt `localhost` im Browser, sonst OAuth-Cookie-Mismatch.

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
npm run dev            # http://127.0.0.1:3000  (Root sniffed UA → /tablet oder /phone)
npm run build          # Produktion (vor der Party)
npm start              # Produktions-Server, State persistiert über Lifetime des Prozesses
npm run build-library -- <playlist-uri> [<playlist-uri> ...]
                       # Power-User-Fallback (CLI, nur public Playlists).
                       # Primärer Weg seit Phase 4b: /admin → "Playlists aus Spotify laden".
                       # Braucht SPOTIFY_CLIENT_ID/SECRET in .env.local; GETSONGBPM_API_KEY optional.
```

**Browser-URL beim OAuth-Flow**: Spotify erlaubt seit Nov. 2024 kein `localhost` mehr als Redirect-URI — nur `127.0.0.1` (oder HTTPS). Konsequenz: die App im Browser über `http://127.0.0.1:3000/...` öffnen, nicht über `localhost:3000/...`, sonst Cookie-Origin-Mismatch beim OAuth-Callback. `SPOTIFY_REDIRECT_URI` muss zum eingetragenen Eintrag im Spotify-Dashboard passen.

## Codebase-Layout

```
app/             Root-Page (UA-Sniff → /tablet | /phone) + Layout
  tablet/        Tablet-Frontend (das, was auf dem iPad läuft)
  phone/         Phone-Frontend (Portrait, User-Mode + DJ-Mode-Hidden-Tap-Unlock)
  admin/         ConnectionStatus + PlaylistPicker (Build) + LibraryEditor (Tags/Energy)
  api/
    lan-url/     LAN-IP-Detection für QR-Code
    library/     Library load/save (PUT mit 409-Race-Schutz bei laufendem Build)
                 build/{POST,[jobId]/stream} (Two-Step-SSE-Build-Pipeline)
    spotify/     OAuth (auth, callback) + Proxy (devices, select-device, queue, now-playing)
                 + status, playlists (Phase 4b)
    state/       stream (SSE) + button (mood/playlist/anti)
    queue/       commit (Tablet-Tap → Spotify Queue + committedId, Host-Privileg)
    guest/       submit (Phone-Tap → FIFO-Gast-Queue mit 1-Slot-Quota)
components/      NowPlayingBar, NextUpCandidates, MoodSection, PlaylistModal, AntiButtons, WifiQrCode
  phone/         PhoneTopBar, NowPlayingCard, HeartbeatBadge, GuestQueueList, …
lib/             mock-data.ts (15 Mock-Tracks + Mood-Fragen)
                 library-schema.ts (Zod, Client-Safe) + library.ts (fs-Wrapper, Server-Only)
                 library-build.ts (Shared Build-Logik + Job-Registry, Server-Only)
                 spotify.ts (Token-Storage in ~/.aidj-app/ + Wrapper + Scopes, Server-Only)
                 state.ts (Party-State-Singleton + EventEmitter + 5s-Polling, Server-Only)
                 guest-queue.ts (In-Memory-FIFO + Mutex + Quota, Server-Only)
                 server-state-types.ts (SSE-Wire-Format, Client-Safe)
                 use-server-state.ts ('use client'-Hook auf EventSource, host|guest-Modi)
                 phone/ (guest-id, guest-name, dj-mode)
                 dj-brain.ts (LLM-Kandidaten via @ai-sdk/anthropic + Heuristik-Fallback, Server-Only)
data/            mock-covers.json, library.json (kuratierte Track-Library für DJ-Brain)
scripts/         fetch-mock-covers.ts, build-library.ts (CLI-Fallback)
public/          PWA-Manifest, Icons
```

## Next.js-Version

Diese Version hat Breaking Changes gegenüber Training-Daten — siehe AGENTS.md. Bevor du eine Next.js-API benutzt, die du "kennst", check `node_modules/next/dist/docs/` oder das aktuelle Verhalten im Code.
