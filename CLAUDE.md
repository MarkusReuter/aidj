@AGENTS.md

# AIDJ — Repo-Onboarding für Claude Code

Touch-only Tablet-App für Partys: Claude wählt Tracks vor, Crowd tippt auf iPad-Karten, Spotify Connect spielt ab. Voller Architektur- und Phasenplan steht in [PLAN.md](./PLAN.md) — lies den, bevor du nicht-triviale Änderungen machst.

## Heutiger Stand

Phase 1 (Tablet-UI mit Mock-Daten) ist aktiv. Spotify-OAuth (Phase 3) und Claude-DJ-Brain (Phase 5) sind **noch nicht** verdrahtet. Keine `.env.local`, keine externen API-Calls, keine echten Tokens.

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
Spotify-Refresh-Token wird in `~/.dj-app/token.json` mit `chmod 0600` gespeichert — nicht im Repo.

## Dev

```bash
npm install
npm run dev       # http://localhost:3000/tablet
npm run build     # Produktion (vor der Party)
npm start         # Produktions-Server, State persistiert über Lifetime des Prozesses
```

## Codebase-Layout

```
app/tablet/      Tablet-Frontend (das, was auf dem iPad läuft)
app/api/         Server-Routen (Spotify-Proxy + SSE ab Phase 3/4)
components/      NowPlayingBar, NextUpCandidates, MoodSection, PlaylistToggles, AntiButtons
lib/             mock-data.ts heute → spotify.ts, dj-brain.ts, state.ts später
data/            mock-covers.json heute → library.json nach Phase 2
scripts/         Einmal-Tools (fetch-mock-covers.ts; später build-library.ts)
public/          PWA-Manifest, Icons
```

## Next.js-Version

Diese Version hat Breaking Changes gegenüber Training-Daten — siehe AGENTS.md. Bevor du eine Next.js-API benutzt, die du "kennst", check `node_modules/next/dist/docs/` oder das aktuelle Verhalten im Code.
