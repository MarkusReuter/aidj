# Party-DJ Tablet App — Implementationsplan

## Context

Auf Partys ist Spotify-Auto-Mix oft zu beliebig: das System kennt weder Stimmung im Raum noch wo wir in der Energy-Curve gerade stehen. Ein echter DJ liest das Publikum (Crowd Reading) und justiert Track-Wahl, Tempo und Energie laufend. Diese App ersetzt diese DJ-Funktion durch:

- **Ein Tablet als physischer Eingabekanal** (100 % touch, **keine Texteingabe**): große Buttons, die Gäste oder Barkeeper bedienen — der "Crowd-Reading-Sensor".
- **Claude als DJ-Vorauswahl**: Der LLM schlägt jeweils 3–4 passende nächste Tracks aus der Library als Kandidaten-Karten vor. Crowd tippt einen an → der wird gequeued. Tippt niemand, wird kurz vor Track-Ende der Top-Kandidat automatisch gequeued.
- **Spotify Connect als Playback**: Musik läuft auf einem Spotify-Connect-Device. Empfohlen: der **Mac selbst** (Spotify-Desktop-App registriert sich als Device) mit Bluetooth-Speaker dran. Alternativ Sonos / AVR / anderes Connect-fähiges Gerät — die App-Logik bleibt identisch. Tablet ist nur Fernbedienung.

Zielergebnis: Eine lokale Next.js-Web-App, die auf dem Mac läuft, das iPad-Frontend über lokales WLAN ausliefert und während der Party autonom Tracks in die Spotify-Queue schiebt — mit Crowd-Feedback als Steuersignal.

**Lieferreihenfolge (Demo-First):**
1. **Erst** die Tablet-UI als Mock-Demo bauen (Phase 1) — mit echten Album-Covern, vollständig durchklickbar, ohne Spotify- oder LLM-Anbindung. Ziel: in der Hand vorzeigen können wie sich das anfühlt.
2. **Dann** Spotify-OAuth + Queue-Control verdrahten (Phase 3).
3. **Zuletzt** den Claude-DJ-Brain hinten anhängen, der die statischen Mock-Kandidaten durch echte LLM-Vorschläge ersetzt (Phase 5).

## Architektur-Überblick

```
 ┌────────────┐                                                     ┌──────────────┐
 │  iPad      │ ─┐                                            ┌───► │ Spotify API  │
 │  /tablet   │  │ LAN   ┌──────────────────────────────┐  HTTPS    │ - Queue      │
 │  Host-UI   │  ├─────► │  Next.js auf Mac (localhost) │ ─┤        │ - Now Playing│
 └────────────┘  │       │  - /tablet (Landscape)       │  │        │ - Devices    │
 ┌────────────┐  │       │  - /phone  (Portrait, Gast)  │  │        │ - Search     │
 │ Smartphone │ ─┘       │  - / → UA-Sniff + Redirect   │  │        └──────┬───────┘
 │  /phone    │  SSE     │  - API Routes (Spotify+Gast) │  │               │
 │  Gast-UI   │ ◄────────┤  - Vercel AI SDK + Claude    │  │       Connect │
 └────────────┘          │  - library.json (kuratiert)  │  │               ▼
                         │  - guestQueue (FIFO, Memory) │  │       ┌────────────────────┐
                         └──────────────────────────────┘  │       │ Connect-Device:    │
                                          │                │       │  • Mac+Spotify-App │
                                          ▼                │       │    → Bluetooth     │
                                  ┌───────────────┐        │       │      → Speaker     │
                                  │ Anthropic API │ ◄──────┘       │  • ODER Sonos /AVR │
                                  │ (Claude)      │                └────────────────────┘
                                  └───────────────┘
```

Beide Endgeräte (iPad-Host und Smartphone-Gäste) reden mit demselben Next.js-Prozess auf dem Mac. Gäste scannen den QR-Code auf dem Tablet, landen auf `/` und werden via User-Agent zum Portrait-`/phone`-UI redirected. Tablet-Host bleibt auf `/tablet`.

**Stack:**
- **Next.js 15** (App Router, TypeScript) — gibt uns React UI + API Routes in einem Repo, läuft lokal mit `npm run dev`.
- **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) — typesafe LLM-Calls mit `generateObject` für strukturierte Track-Auswahl und dynamische Mood-Fragen.
- **Spotify Web API** (`@spotify/web-api-ts-sdk`) — OAuth (Authorization Code with PKCE), Queue-Control auf aktivem Connect-Device.
- **Server-Sent Events (SSE)** — Tablet pollt nicht, sondern subscribed auf Server-State (aktueller Track, neue Mood-Frage, Button-Counts).
- **Tailwind** — schnelle, große Touch-Targets.
- **Anthropic Prompt Caching** — Library wird nur einmal in den Prompt gestopft und pro Pick-Call wiederverwendet → spart 90 % Tokens.

## Vier-Sektion-UI auf dem Tablet (touch-only, keine Tastatur)

```
┌─────────────────────────────────────────────────────────────────┐
│  🎵 Now Playing: "Strobe" – deadmau5            03:12 / 10:30   │
├─────────────────────────────────────────────────────────────────┤
│  NEXT UP — tippe einen Track:                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │  [cover]   │ │  [cover]   │ │  [cover]   │ │  [cover]   │   │
│  │            │ │            │ │            │ │            │   │
│  │ One More   │ │ Insomnia   │ │ Around the │ │ Music      │   │
│  │ Time       │ │            │ │ World      │ │ Sounds Bet │   │
│  │ Daft Punk  │ │ Faithless  │ │ Daft Punk  │ │ Stardust   │   │
│  │ ✓ 123 BPM  │ │ ✓ 128 BPM  │ │ ✓ 121 BPM  │ │ ✓ 124 BPM  │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│  ⏱ Auto-Pick in 0:23, falls niemand tippt                       │
├─────────────────────────────────────────────────────────────────┤
│  ❓  "Wie ist die Vibe gerade?"        (← LLM-generiert)        │
│  [🥱 Müde] [👌 Geht] [🔥 Heiß] [🚀 Voll]                       │
│                                                                 │
│  PLAYLISTS:                                                     │
│  [Warm-Up] [Peak Time] [Banger] [House Floor] [Hip-Hop Heads]   │
│  [80s Memories] [Latino] [Indie Vibes] [Closer]                 │
│                                                                 │
│  [⏭ Skip Jetzt]   [👎 Nicht das]   [❤️ Mehr davon]              │
└─────────────────────────────────────────────────────────────────┘
```

- **Next-Up-Kandidaten (3–4, top section)**: Vom LLM vorgeschlagene Tracks als große Tap-Karten mit Cover-Art, Title, Artist, BPM. Tap = wird sofort als nächstes gequeued, Karten refreshen mit neuen Vorschlägen für den Slot danach. Wenn niemand tippt, wird ~10 s vor Track-Ende automatisch der Top-Kandidat (links) gequeued.
- **Mood-Buttons (dynamisch, 4–6)**: Werden vom LLM generiert; Frage + Options ändern sich alle paar Tracks oder bei Energie-Shift. Beispiele: "Energy?" / "Genre-Wunsch?" / "Tempo?" / "Härter oder weicher?" Diese Klicks beeinflussen, *welche* Kandidaten der LLM als Nächstes vorschlägt — nicht den aktuellen Pick direkt.
- **Playlist-Toggles (statisch, 9 Toggles)**: Vom Host vor der Party kuratierte logische Gruppen (z. B. "Warm-Up", "Peak Time", "Banger", "House Floor", "Hip-Hop Heads", "80s Memories", "Latino", "Indie Vibes", "Closer"). Dienen als Filter-Hint für den LLM, statt der Crowd Roh-Genres aus der Library zumuten zu müssen. Playlists sind semantischer als pure Genre-Buckets, weil sie Phase/Energie/Stil mischen. Künftige Erweiterung: aus echten Spotify-Playlists ableiten. Aufteilung im UI: 5 Buttons in Reihe 1, 4 in Reihe 2 — auf 1280 px Landscape gut tappbar.
- **Anti-Buttons (3 statisch)**: ⏭ Skip Jetzt (überspringt den aktuell laufenden Track sofort und queued den Top-Kandidaten), 👎 Nicht das (drückt Tags des aktuellen Tracks für künftige Picks runter), ❤️ Mehr davon (boostet Tags des aktuellen Tracks).

**Keine Texteingabe im Tablet-UI**: Keine Suchleiste, kein Volume-Schieberegler, kein Login auf `/tablet`. Volume regelt der Speaker / der Mac. Alle Settings macht der Host vorher am Mac. — Ausnahme: die Search-Box auf `/phone` (siehe nächster Abschnitt) ist der **einzige** `<input>` der App; auf `/tablet` gibt es weiterhin null Texteingabe.

## Phone-UI für Gäste (Portrait + User/DJ-Modus)

Wenn Gäste den QR-Code auf dem Tablet scannen, kommen sie auf `/`. Ein Server-side UA-Sniffer redirected Smartphones zu `/phone`, Tablets/Desktops zu `/tablet`. Die Phone-Route ist Portrait-optimiert (max-w-md, vertikales Stack-Layout) und hat zwei Modi:

```
┌────────────────────────────────┐
│  [🎵] AIDJ           [Slot ✓]  │  ← PhoneTopBar (Logo links = 10× Tap-Zone für DJ)
├────────────────────────────────┤
│        ┌────────────┐          │
│        │   Cover    │          │  ← NowPlayingCard
│        │  240×240   │          │
│        └────────────┘          │
│   "Strobe" — deadmau5          │
│   ▓▓▓▓▓░░░░░░ 03:12 / 10:30    │
├────────────────────────────────┤
│  🔥 Crowd ist heiß             │  ← HeartbeatBadge (aggregiert)
├────────────────────────────────┤
│  WÄHLE NÄCHSTEN TRACK:         │
│  ┌──────────────────────────┐  │
│  │ [c] One More Time  124   │  │  ← PhoneCandidates (vertikal)
│  │ [c] Insomnia       128   │  │
│  │ [c] Around the W.  121   │  │
│  └──────────────────────────┘  │
│  ─── oder ───                  │
│  🔍 Track suchen…              │  ← SearchAutocomplete (einziger <input>)
│                                │
├────────────────────────────────┤
│  GAST-QUEUE (FIFO):            │
│  1. [c] Insomnia  — Anna       │  ← GuestQueueList
│  2. [c] Strobe    — du ⭐      │
└────────────────────────────────┘

   ╔════ DJ-MODE (nur nach 10× Tap auf Logo) ════╗
   ║  Mood-Frage + 4 Mood-Buttons               ║
   ║  9 Playlist-Toggles (Portrait: 2 Spalten)  ║
   ║  [⏭ Skip] [👎 Nicht das] [❤️ Mehr davon]   ║
   ╚════════════════════════════════════════════╝
```

**Sichtbar je Modus**:

| Element                  | User-Mode | DJ-Mode |
|---|---|---|
| NowPlayingCard           | ✓ | ✓ |
| HeartbeatBadge           | ✓ | ✓ |
| GuestStatusBadge         | ✓ | ✓ |
| PhoneCandidates          | ✓ | ✓ |
| SearchAutocomplete       | ✓ | ✓ |
| GuestQueueList           | ✓ | ✓ |
| MoodSection              | ✗ | ✓ |
| PlaylistToggles          | ✗ | ✓ |
| AntiButtons (Skip/👎/❤️) | ✗ | ✗ + ✓ |

**DJ-Mode-Unlock**: 10× Tap innerhalb 2 Sekunden auf das App-Logo in `PhoneTopBar`. Persistiert in `localStorage["aidj_dj_mode"]`, gleicher Tap-Counter deaktiviert wieder. Der DJ-Mode ist **lokal pro Gerät** — kein Server-side Schutz, bewusste Low-Friction-Lösung für Hausparty-Kontext. *(Anmerkung zum Wording "QR-Code-Tap": Auf der Phone-UI selbst gibt es keinen QR-Code — der hängt am Tablet. Die analoge Geheim-Tap-Zone auf dem Phone ist das App-Logo in `PhoneTopBar`.)*

**Gast-Identifikation**: UUID in `localStorage["aidj_guest_id"]`, einmal generiert pro Gerät. Cache-Clear → neue Identity → Quota-Reset. Bewusst kein Login, kein Captcha (Hausparty).

**UA-Routing auf `/`**: Server-side via `userAgent()` aus `next/server`. **Achtung iPad-Edge-Case**: iPadOS-Safari sendet "Mobile" im UA aber keine "iPad"-Markierung — naive Regex auf `/mobile|iphone|android/` würde iPads fälschlich zur Phone-UI schicken. Korrekte Heuristik: Next.js' `userAgent()` parsed Device-Type (`mobile|tablet|console|wearable|embedded`) — nur `mobile` → `/phone`, sonst `/tablet`. Zusätzlich client-side CSS-Media-Query (Portrait + max-width 600px) als Fallback-Override.

## Gast-Track-Submission (FIFO + 1-Slot-Quota)

Gäste können auf dem Phone Tracks zur Wiedergabe beisteuern — entweder durch Tap auf eine AI-Kandidaten-Karte oder durch Such-und-Add via Autocomplete. Beide Wege schreiben in dieselbe Server-side FIFO-Queue.

**Regeln**:
- **1 Track pro Gast** zur selben Zeit: solange der eigene Track in `pending` oder `playing` ist, lehnt der Server weitere Submissions mit HTTP 409 ab. Das Phone-UI zeigt das via `GuestStatusBadge` ("Position 2 in Queue" vs "Slot frei").
- **Quota-Reset** sobald der Track `done` ist (regulär ausgespielt oder via Skip übersprungen). Optional Timeout (15 min) gegen festsitzende Slots — finale Entscheidung in Phase 4a.
- **Reihenfolge**: strikt FIFO nach `submittedAt`-Timestamp.
- **AI pausiert**: Solange `guestQueue.filter(e => e.status === 'pending').length > 0`, überspringt der DJ-Brain seinen `proposeNextCandidates()`-Call und liefert stattdessen die Gast-Queue als Pseudo-Kandidaten zurück (Top = FIFO-Head). Erst wenn die Queue leer ist, übernimmt das LLM wieder.
- **Lock-Window**: ~10 s vor Track-Ende wird der nächste Track in die Spotify-Queue geschoben — das ist entweder der FIFO-Head der Gast-Queue oder (wenn leer) der Top-Brain-Kandidat.

**Edge-Cases**:
- **Race auf gleiche AI-Karte**: Zwei Gäste tippen gleichzeitig dieselbe Karte → der Server-Mutex in `lib/guest-queue.ts` serialisiert die Writes; erster Request gewinnt den Slot, zweiter bekommt 409. Phone-UI zeigt klare Fehlermeldung.
- **Idempotenz**: Submission enthält `submissionId` (clientseitig generiert), Server dedupliziert über kurze TTL — schützt vor Doppel-Submit bei Netzwerk-Retry/Browser-Crash mid-Tap.
- **Gast geht offline**: Der reservierte Slot bleibt bis natürlicher `played`/`skipped`-Trigger belegt. Andere Gäste sehen den Track weiter in der Queue.
- **Server-Restart** (z.B. wegen Update): Queue lebt heute nur im Prozess-Memory (siehe CLAUDE.md "Production-Mode statt Dev-Mode"). Persistenz nach `data/guest-queue.json` mit Atomic-Write ist optional; finale Entscheidung als offener Punkt unten.
- **Cross-Channel-DJ-Skip**: Sowohl Phone-DJ als auch Tablet-Host können skippen. Server ist idempotent gegen Doppel-Skip — letzter gewinnt, Slot wird einmal frei.

## Phasen-Plan

### Phase 0: Projekt-Setup (minimal für Demo)

- `npx create-next-app@latest aidj --typescript --tailwind --app` im AIDJ-Ordner.
- Installieren: `zod` (für Mock-Daten-Schemas, später vom DJ-Brain wiederverwendet).
- **Noch nicht** installieren / setup: Spotify-SDK, Vercel AI SDK, .env-Keys, Spotify Dev Dashboard, GetSongBPM. Das alles kommt erst ab Phase 3, damit die Demo so wenig Reibung wie möglich hat.

### Phase 1: Tablet-UI-Demo mit Mock-Daten (Vorzeige-Stand) ⭐

**Ziel**: Eine fertig aussehende, vollständig durchklickbare Tablet-UI, die du deiner Frau auf dem iPad zeigen kannst. Läuft komplett mit Mock-Daten — keine externen APIs, kein Backend-State, kein OAuth. Im Browser/iPad sieht es aus und fühlt sich an wie das Endprodukt.

**Mock-Datenquelle** (`lib/mock-data.ts`):
- Hardcoded Array von ~15 Fake-Tracks mit:
  - `title`, `artist`
  - `coverUrl` — via **iTunes Search API** einmalig generiert (`scripts/fetch-mock-covers.ts`, kein API-Key nötig: `https://itunes.apple.com/search?term=<artist>+<title>&entity=song&limit=1`). Gibt frei nutzbare URLs `https://is*-ssl.mzstatic.com/...`. URLs werden in die Mock-Daten gepinnt, damit die Demo offline läuft.
  - `bpm`, `durationMs`, `genre`
- 5–6 vordefinierte Mood-Fragen mit Options (rotieren beim Demo).
- Playlist-Liste: 9 Playlists fest verdrahtet (vom Host vor der Party definierte logische Gruppen; späteres Spotify-Playlist-Mapping als Erweiterung möglich).

**`app/tablet/page.tsx`** — die Komponente, die später unverändert auch in Produktion läuft:
- Layout wie ASCII-Skizze (s. oben).
- Komponenten:
  - `<NowPlayingBar />` — Cover (groß, links), Title/Artist, Progress-Bar (animiert mit fake Timer).
  - `<NextUpCandidates />` — 4 Karten aus Mock-Daten:
    - Cover-Bild groß (min. 160 × 160 px, `object-cover`, Image-Optimization via Next.js `<Image />`).
    - Title (truncated bei Bedarf), Artist (kleiner), BPM-Badge.
    - Tap → Karte wird **committed**: hebt sich hervor (`ring-4 ring-green-400`), andere werden ausgegraut (`opacity-40`) und bleiben das, bis der aktuelle (Mock-)Track endet — das ist auch das echte Phase-5-Verhalten. Erneuter Tap auf eine andere Karte ändert den Commit (solange Lock-Window noch offen).
    - Auto-Pick-Countdown: zählt von 0:30 runter, bei 0:00 (= simuliertes Track-Ende) wird, falls niemand committed hat, die Top-Karte automatisch committed. Anschließend Übergang → neue 4 Mock-Karten.
  - `<MoodSection />` — Frage + 4 Mood-Buttons. Tap = Button pulst kurz + Counter ("🔥 3" als kleines Badge). Alle 4 "echten" Tracks wechselt die Frage zur nächsten aus der Mock-Liste.
  - `<PlaylistToggles />` — 9 Toggles in 2 Reihen (5 + 4), Tap = aktiv/inaktiv (visuell `bg-purple-500` vs `bg-zinc-700`).
  - `<AntiButtons />` — 3 große Buttons. Tap = Toast-Feedback ("Skip wird ausgeführt..." / "Nicht das gemerkt" / "Mehr davon gemerkt") für ~1.5 s.
- **State-Management Demo-Modus**: alles lokaler React-State + `setInterval` für den Countdown. Kein SSE, kein API-Call.
- **Demo-Loop**: Erst wenn der simulierte Track endet (Countdown = 0 oder manueller Skip) → 2-Sekunden-Übergang → neue Mock-Karten + neuer "Now Playing" Track. Während ein Track läuft, ändern Taps nur den Commit, nicht die Karten — sonst gewöhnt man sich an ein Verhalten, das die echte App nicht hat.

**Visuelles Polish** (das, was die Demo glaubwürdig macht):
- Dark Mode by default (Party-Vibe), Akzent-Farbe Purple/Pink-Gradient.
- Cover-Bilder mit Blur-Background hinter dem Now-Playing-Bereich (CSS `backdrop-filter: blur(40px)` auf großem skaliertem Cover).
- Smooth Transitions zwischen Kartensets (Tailwind `transition-all duration-300 ease-out`).
- Pulsierender BPM-Badge im Takt (CSS-Animation `animation-duration: calc(60s / var(--bpm))`).
- **iPad-Ziel-Layout: Landscape 1024×768** (4-Karten-Reihe braucht die Breite). Portrait-Fallback per `@media (orientation: portrait)`: Kandidaten als 2×2-Grid. Mood/Playlist-Buttons darunter immer flow-Layout.
- iOS-Safari-Quirks und PWA-Fullscreen (nötig, damit "Zum Home-Bildschirm" als echte App wirkt):
  - `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
  - `public/manifest.json` mit `"display": "standalone"`, `"orientation": "landscape"`, `"background_color": "#0a0a0a"`
  - CSS: `-webkit-tap-highlight-color: transparent`, `user-select: none`, `touch-action: manipulation`.

**`next.config.js`** — Bild-Domains erlauben:
```js
images: { remotePatterns: [
  { protocol: 'https', hostname: 'i.scdn.co' },         // Spotify CDN
  { protocol: 'https', hostname: '**.mzstatic.com' },   // iTunes Cover (is1-ssl, is2-ssl, …)
]}
```

**Demo-Test (vor dem Vorführen)**:
1. `npm run dev`.
2. Auf iPad in Safari öffnen `http://<mac-lan-ip>:3000/tablet` → "Zum Home-Bildschirm hinzufügen" → Fullscreen.
3. Durchgehen: Karte tippen → andere ausgrauen, ausgewählte highlighten ✓
4. Mood-Button tippen → Counter erscheint ✓
5. Playlist togglen → visuell aktiv ✓
6. Skip-Button → Toast ✓
7. 30 s warten → Auto-Pick passiert → neue Karten ✓
8. Cover-Bilder laden alle, keine kaputten Bild-Icons ✓
9. Sieht das ganze gut aus? Frau zeigen.

### Phase 1a: Phone-UI Mock-Demo (Portrait + User/DJ-Modus)

**Ziel**: Smartphones bekommen ihre eigene Portrait-UI mit Such-Box, Gast-Queue-Anzeige und versteckter DJ-Mode-Funktion. Komplett mock-getrieben, keine externen APIs, kein Server-State — gleicher Demo-Anspruch wie Phase 1.

**Voraussetzung-Refactor (vor allen Phone-Komponenten)**:
- `lib/mock-loop.ts` extrahieren: aktuelle Game-Loop-Logik aus `app/tablet/page.tsx` (currentTrack, candidates, committedId, progressMs, moodCounts, activePlaylists, moodQuestionIdx) in einen geteilten Hook `useMockLoop()` hochziehen. Tablet- und Phone-Page konsumieren denselben Hook.
- Regressionstest: Tablet-UI muss nach Refactor 100 % identisch funktionieren.

**UA-Routing auf `/`** (`app/page.tsx`):
- Heute Next.js-Default-Markup → ersetzen durch Server-Component mit `userAgent()`-Aufruf aus `next/server`.
- Routing-Logik: `device.type === 'mobile'` → `redirect('/phone')`, sonst → `redirect('/tablet')`.
- Vor Implementierung Next.js-Docs (`node_modules/next/dist/docs/`) prüfen — Next 15 hat ggf. andere API-Form (siehe AGENTS.md).

**Komponenten** (alle in `components/phone/`):
- `PhoneTopBar.tsx` — Logo links als Tap-Zone (10× → `useDjMode().registerTap()`), `GuestStatusBadge` rechts.
- `NowPlayingCard.tsx` — Cover 240×240, Title/Artist, Progress-Bar. Re-use von Mock-Loop-State.
- `HeartbeatBadge.tsx` — kleiner Pill mit Mood-Symbol (🔥/❄️/⚡/💧). Im Mock rotiert alle paar Sekunden basierend auf moodCounts.
- `GuestStatusBadge.tsx` — Zwei States: "Slot frei – wähle einen Track" vs "Dein Track ist in der Queue (Position 2)". Im Mock einfach togglebar.
- `PhoneCandidates.tsx` — 4 Kandidaten vertikal gestapelt: Cover links 80×80, Title/Artist/BPM rechts. Tap = highlight, andere disabled bis simulated Track-Ende. Re-use von `useMockLoop()`-State.
- `SearchAutocomplete.tsx` — `<input type="search" inputMode="search">` mit Debounce 250ms, Dropdown mit max. 8 Results. **API-Design**: bekommt `searchFn: (q: string) => Promise<Result[]>` als Prop. In Phase 1a ist `searchFn` ein lokaler Wrapper über Mock-Tracks (Substring-Match). In Phase 3a wird `searchFn` durch `fetch('/api/search?q=…')` ersetzt — Komponente bleibt unverändert.
- `GuestQueueList.tsx` — vertikale Liste mit Position, Cover-Thumb 48×48, Title/Artist + "von <Gast-ID-Kurzform>". Eigener Track visuell hervorgehoben (`ring-2 ring-purple-400`). Im Mock zeigt 2 Beispiel-Einträge.

**Hooks/Libs**:
- `lib/phone/guest-id.ts` — `getOrCreateGuestId()` schreibt/liest UUID in `localStorage["aidj_guest_id"]`. SSR-safe (kein Window-Zugriff auf Server).
- `lib/phone/dj-mode.ts` — `useDjMode()`-Hook: `{ isDj, registerTap }`. 10×-Tap-Counter mit 2 s-Timeout (Reset bei zu langsamem Tappen). Persistiert in `localStorage["aidj_dj_mode"]`.

**Page-Komposition** (`app/phone/page.tsx`):
- Layout: `min-h-screen flex flex-col max-w-md mx-auto bg-zinc-950 text-zinc-100`.
- Render-Reihenfolge: PhoneTopBar → NowPlayingCard → HeartbeatBadge → PhoneCandidates → SearchAutocomplete → GuestQueueList.
- Conditional Render: wenn `useDjMode().isDj === true` → zusätzlich am unteren Rand `<MoodSection />` (Single-Row-Layout), `<PlaylistToggles />` (Portrait-Variante: 2 Spalten statt 3×3 — `grid-cols-2`), `<AntiButtons />`. Diese drei sind bestehende Tablet-Komponenten — Layout-Anpassungen via responsive Tailwind-Klassen.

**Manifest-Update** (`public/manifest.json`):
- `orientation: "landscape"` → `"any"` (Tablet bekommt Landscape implizit via Viewport-Größe, Phone Portrait).
- `start_url: /tablet` → `/` (lässt den UA-Router entscheiden).

**Demo-Test (vor dem Vorführen)**:
1. iPhone in Safari öffnet `http://<mac-lan-ip>:3000/` → Redirect zu `/phone`.
2. iPad-Test: `http://<mac-lan-ip>:3000/` → Redirect zu `/tablet`, **nicht** zu `/phone`.
3. Desktop-Browser → `/tablet` wie heute.
4. PhoneTopBar, NowPlayingCard, HeartbeatBadge sichtbar.
5. PhoneCandidates: Karte tippen → highlight, andere ausgegraut bis Mock-Track-Ende.
6. SearchAutocomplete: tippen → Mock-Vorschläge nach 250ms; Tap auf Vorschlag → "Track wählen"-CTA → Tap → GuestStatusBadge wechselt auf "Position 1", Track erscheint in GuestQueueList mit ⭐.
7. Mood-/Playlist-/Skip-Buttons NICHT sichtbar.
8. Logo 10× innerhalb 2 s tippen → DJ-Mode-Indikator + Mood/Playlist/Anti-Buttons werden sichtbar.
9. Refresh → Guest-ID + DJ-Mode-Flag bleiben.
10. Tablet-Regression: `/tablet` läuft nach Mock-Loop-Refactor 1:1 wie vorher.

### Phase 2: Library-Tagging-Tool (einmalig vor jeder Party)

Hybrid-Ansatz wie gewünscht: BPM von Drittquelle, Genre von Spotify, Mood manuell editiert. Begründung für Drittquelle: Spotifys Audio-Features-API (mit `tempo`/BPM, `energy` etc.) wurde im November 2024 für neue Apps eingeschränkt — wir können nicht darauf bauen.

**`scripts/build-library.ts`** (Node-Script, einmal pro Party-Vorbereitung):
1. Input: Eine oder mehrere Spotify-Playlist-URLs (CLI-Args oder Config-File).
2. Für jeden Track in jeder Playlist:
   - Spotify API: Track-Metadata + Artist-Objekt → übernimm `artists[].genres` als Genre-Tags. (Hinweis: Genres hängen am Artist, nicht am Track — bei sehr kleinen Artists kann das Array leer sein, dann bleibt `spotifyGenres: []`.)
   - GetSongBPM API: BPM-Lookup per Artist+Title (fuzzy, kann fehlschlagen).
   - Fallback bei BPM-Lookup-Fail: Feld `bpm: null` → LLM weiß dann, BPM nicht zu beachten.
3. Schreibe `data/library.json`:
   ```json
   {
     "tracks": [
       {
         "uri": "spotify:track:…",
         "title": "Strobe",
         "artist": "deadmau5",
         "durationMs": 630000,
         "spotifyGenres": ["progressive house", "electro house"],
         "bpm": 128,
         "moodTags": [],          // manuell zu füllen
         "energyLevel": null      // manuell 1-10
       }
     ]
   }
   ```
   Tonart (`key`) wird bewusst weggelassen — Spotify Connect macht keine echten harmonischen Übergänge, also wäre das Feld toter Ballast für den Prompt.

**`app/admin/page.tsx`** (Library-Editor-UI, läuft im Browser auf dem Mac):
- Tabellen-Ansicht aller Tracks aus `library.json`.
- Pro Track: Mood-Tags-Multiselect (z. B. "warm-up", "peak", "afterhours", "feelgood", "melancholic", "banger") + Energy-Slider 1–10.
- "Auto-suggest with Claude" Button: lässt Claude für eine Auswahl Mood-Tags vorschlagen, die du dann übernimmst/korrigierst.
- Save schreibt zurück auf `data/library.json`.

### Phase 3: Spotify-Integration

**Voraussetzungen** (harte Blocker, vorher prüfen):
- Der Spotify-Account, mit dem wir uns einloggen, **muss Premium sein**. `PUT /me/player/queue`, Transfer Playback und Device-Steuerung sind allesamt Premium-only — mit Free läuft die App nicht.
- Mac und iPad im gleichen WLAN, macOS-Firewall erlaubt eingehende Verbindungen auf Port 3000 (kommt als Systemdialog beim ersten `next start`).

**Setup, das jetzt fällig wird** (in Phase 0 bewusst ausgelassen):
- Installieren: `@spotify/web-api-ts-sdk`.
- `.env.local` anlegen mit `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback`.
  - **Wichtig**: Spotify hat seit Nov. 2024 `localhost` als Redirect-URI gesperrt — nur `127.0.0.1` (oder HTTPS-Hosts) werden akzeptiert. Konsequenz: die App auch im Browser über `http://127.0.0.1:3000/...` öffnen, **nicht** über `localhost:3000` — sonst Cookie-Origin-Mismatch beim OAuth-Callback (Browser behandelt `localhost` und `127.0.0.1` als unterschiedliche Origins).
- Spotify Dev Dashboard: App registrieren, Redirect-URI eintragen, Premium-Account dort als Test-User hinterlegen (App ist im Development-Mode, nur eingetragene User dürfen sich einloggen).

**OAuth-Flow**: **Authorization Code Flow** (ohne PKCE). Die App läuft als Confidential Client lokal auf dem Mac mit Zugriff auf den Client Secret — PKCE wäre nur für Public Clients (SPA/Mobile) nötig und würde uns hier keine zusätzliche Sicherheit bringen. Scopes: `user-modify-playback-state user-read-playback-state user-read-currently-playing`.

**`app/api/spotify/`**:
- `auth/route.ts` — startet OAuth-Flow, redirect zu Spotify.
- `callback/route.ts` — empfängt Code, tauscht gegen Access+Refresh Token, speichert in `~/.aidj-app/token.json` mit `chmod 0600` (Datei enthält Refresh-Token, das per se kein Login-Secret ist, aber trotzdem nur dem User gehört).
- `devices/route.ts` — `GET` listet aktive Connect-Devices.
- `select-device/route.ts` — `POST { deviceId }` setzt aktives Playback-Device.
- `queue/route.ts` — `POST { uri }` ruft `PUT /me/player/queue?uri=…` auf.
- `now-playing/route.ts` — `GET` proxiert `/me/player` (Track + Progress + isPlaying).

**`lib/spotify.ts`** — Wrapper-Modul:
- `getClient()` — gibt SDK-Instanz mit Auto-Refresh zurück (lädt Token aus `~/.aidj-app/token.json`, refresht bei 401 und schreibt neue Tokens zurück).
- `addToQueue(uri)`, `skip()`, `getCurrentTrack()`, `getDevices()`.

Polling-Strategie für Now-Playing: kein Browser-Polling, sondern **Server-side** ein Interval (alle 5 s), das den State im Memory updated und via SSE an alle verbundenen Tablets pusht. **Polling läuft nur, solange ≥ 1 SSE-Client connected ist** — beim Connect des ersten Tablets startet der Interval, beim Disconnect des letzten wird er gestoppt. Spart Spotify-API-Quota und verhindert, dass die App auch ohne Party stillschweigend Calls feuert. (Spotify-Rate-Limit liegt bei ~180 req/min/app — bei 5s-Interval = 12 req/min, völlig unkritisch, aber das Pause-Verhalten ist ohnehin sauberer.)

### Phase 3a: Spotify-Search-Proxy (Phone-Suche an echte API anbinden)

**Ziel**: Die `SearchAutocomplete`-Komponente aus Phase 1a wechselt von Mock-Suche auf echte Spotify-Treffer + Treffer aus der kuratierten Host-Library.

**Voraussetzung**: PLAN-Phase 3 (Spotify-OAuth + `lib/spotify.ts`) ist abgeschlossen. Same Authorization-Code-Token wird wiederverwendet — kein zusätzlicher OAuth-Pfad nötig (Search braucht keinen extra Scope).

**`app/api/search/route.ts`**:
- `GET /api/search?q=<query>&scope=playlist|all` (Default `all`).
- `scope=playlist`: lokaler Substring/Fuzzy-Match über die schon im Speicher liegende `data/library.json`. Kein Spotify-Call.
- `scope=all`: hits `client.search(query, ['track'], market, 10)`. Optional zusätzlich `scope=playlist`-Match mergen, Playlist-Hits zuerst.
- Jeder Result-Eintrag bekommt `source: 'playlist' | 'spotify'` als Tag — UI kann unterschiedlich badgen.

**Server-Cache** in `lib/spotify.ts`:
- LRU-Cache (Query → Results, TTL 60 s). Bei mehreren parallel tippenden Gästen ist die Wahrscheinlichkeit hoch, dass derselbe Prefix mehrmals gesucht wird → Cache spart Spotify-Quota deutlich.
- Cache-Key = `${query.toLowerCase()}:${scope}`.

**Spotify-Such-API-Eigenheiten** (recherchiert):
- `GET /v1/search` mit `type=track`, `limit` 1–50, `offset` 0–1000, `market`-Parameter (ISO-Code).
- Query-Filter: `artist:`, `year:`, `genre:`, `track:`, `album:`. Für Gast-Such-Box reicht plain text.
- Kein dediziertes Autocomplete-Endpoint — Standard ist `/search?limit=10`, debounced clientseitig.
- **Hinweis "Spotify Dev Mode Changes" (Februar 2026)**: Diese sind seit ~3 Monaten in Kraft. Bei PLAN-Phase-3-Setup (App-Registrierung im Dashboard) konkret prüfen, welche Beschränkungen für non-Production-Apps gelten und ob Production-Mode-Approval nötig ist.

**Refactor an `SearchAutocomplete.tsx`** (aus Phase 1a):
- `searchFn`-Prop wechselt von Mock-Wrapper zu `(q) => fetch(`/api/search?q=${encodeURIComponent(q)}&scope=all`).then(r => r.json())`.
- Komponenten-Code bleibt unverändert — nur die Page-Verdrahtung in `app/phone/page.tsx` ändert sich.

### Phase 4: Tablet-Frontend an echten Backend-State anbinden

UI-Komponenten existieren bereits aus Phase 1. In dieser Phase wird der lokale Mock-State durch echte Server-Daten ersetzt — die Komponenten selbst bleiben weitgehend unverändert.

**Server-State-Layer** (`lib/state.ts`):
- In-Memory `PartyState`: aktueller Track, History, Kandidaten-Liste, aktuelle Mood-Frage, Button-Event-Log.
- **Pub-Sub für SSE**: ein Node-`EventEmitter` (Modul-Singleton), auf den alle aktiven SSE-Streams subscriben. Bei jedem State-Update wird `emitter.emit('state', snapshot)` gefeuert — jeder verbundene Stream pusht den Snapshot an sein Tablet. Ohne dieses Singleton würde ein naiv geschriebener Stream nur einen Client bedienen; mit ist ein zweites Tablet (z. B. an der Bar) ohne Mehraufwand möglich.
- **Lifecycle**: ein Subscriber-Counter zählt aktive SSE-Verbindungen. Erster Subscribe → startet das Spotify-Polling-Interval. Letzter Unsubscribe → stoppt es. So macht die App ohne Tablets nichts.
- **Persistenz-Hinweis**: State liegt nur im Memory des Node-Prozesses. Während der Party muss die App im **Production-Mode** (`next start`) laufen, nicht im Dev-Mode — HMR/Auto-Restart würde State wegwerfen.
- Update-Triggers: Spotify-Polling (alle 5 s) aktualisiert `currentTrack`, Button-Posts schreiben ins Event-Log.

**API-Routen**:
- `app/api/state/stream/route.ts` — SSE-Endpoint via `ReadableStream`. Schickt initial einen vollen `snapshot`-Event, abonniert dann den `EventEmitter` und pusht weitere `snapshot`-Events bei jedem State-Update. Cleanup (`controller.close` + `emitter.off`) im `cancel`-Callback des Streams.
- `app/api/state/button/route.ts` — `POST { type, value, timestamp }` für Mood/Playlist/Anti-Button-Press.
- `app/api/queue/commit/route.ts` — `POST { trackUri }` für Kandidaten-Tap → ruft `spotify.addToQueue()`.

**Refactor an `app/tablet/page.tsx`**:
- Ersetze `setInterval` + lokale Mock-Daten durch `useEffect` + `EventSource('/api/state/stream')`.
- **Reconnect-Hardening**: `EventSource` reconnected automatisch, aber iPad-Safari kappt den Stream sobald der Bildschirm sleept oder Safari in den Hintergrund geht. Beim `onopen`-Event den ersten Snapshot vollständig in den State übernehmen (kein Delta-Merging mit altem State), damit nach längerer Trennung wieder das richtige Bild da ist. Optional: `visibilitychange`-Listener, der bei sichtbar werdender Seite proaktiv reconnected.
- Tap-Handler rufen jetzt die echten API-Routen statt nur lokalen State zu mutieren.
- Komponenten-Props ändern sich nicht — nur die State-Quelle wechselt von Mock-Hook zu SSE-Hook.

Touch-Optimierung (war schon in Phase 1 da, hier nur zur Erinnerung): min. 120 × 120 px pro Button, Kandidaten-Karten min. 200 × 240 px, kein Hover, `touch-action: manipulation`, Fullscreen via PWA-Manifest, `user-select: none`, keine `<input>` / `<textarea>` im **Tablet**-UI (auf `/phone` ist die Search-Box die bewusste Ausnahme — Lint-Regel sollte den Pfad-Filter berücksichtigen).

### Phase 4a: Gast-Queue im Server-State (FIFO + Quota + SSE)

**Ziel**: Die Gast-Submissions vom Phone (Phase 1a-UI) bekommen Server-State, werden FIFO-verwaltet, gegen Multi-Phone-Race geschützt und via SSE an alle Geräte gepusht.

**`lib/guest-queue.ts`** — Kernlogik:
```ts
type GuestStatus = 'pending' | 'playing' | 'done';
type GuestEntry = {
  guestId: string;
  trackUri: string;
  trackMeta: { title: string; artist: string; coverUrl: string; durationMs: number };
  submittedAt: number;
  status: GuestStatus;
  submissionId: string; // clientseitig generiert, Server dedupliziert
};

export const guestQueue = {
  enqueue(entry): Promise<GuestEntry>     // 409 wenn guestId schon pending/playing
  peekNext(): GuestEntry | null            // FIFO-Head der pending-Entries
  markPlaying(trackUri): void              // beim Queue-Push an Spotify
  markDone(trackUri): void                 // bei Track-Ende / Skip
  remove(guestId, submissionId): void      // optional für Future "Track zurücknehmen"
}
```
- **Atomare Writes**: alle Mutationen in einen Mutex/serialisierte Promise-Chain hängen. Verhindert Race wenn zwei Phones gleichzeitig posten.
- **Idempotenz**: Wenn ein Request mit derselben `submissionId` innerhalb von 30 s nochmal kommt → gleichen Entry zurückgeben statt zweiten zu erzeugen.

**`app/api/guest/submit/route.ts`**:
- `POST { trackUri, submissionId, trackMeta }` mit Header `X-Guest-Id`.
- Validiert: Guest-Id-Format (UUID), Track-Meta-Pflichtfelder, optional Spotify-URI-Schema (`spotify:track:…`).
- Ruft `guestQueue.enqueue()`. 200 mit Position bei Erfolg, 409 bei Quota-Verletzung mit klarer Fehlermeldung ("Du hast schon einen Track in der Queue").

**`app/api/guest/queue/route.ts`** (optional, falls SSE nicht reicht):
- `GET` → aktuelle Queue als Snapshot. Hauptweg ist aber SSE.

**Erweiterung `lib/state.ts`** (PLAN-Phase 4):
- `PartyState` bekommt Feld `guestQueue: GuestEntry[]`.
- Snapshot via SSE pusht jetzt auch die Queue an alle verbundenen Clients (Tablet + alle Phones).
- Track-Lifecycle-Trigger ruft `guestQueue.markDone(currentTrackUri)` bei Track-Ende oder Skip.

**Phone-SSE-Reconnect-Hardening** (zusätzlich zum Tablet-Hardening in Phase 4):
- iOS-Safari auf iPhone kappt SSE bei Background/Sperrbildschirm noch aggressiver als auf iPad — Phones gehen häufiger in Background (Notification, Sperrbildschirm).
- `EventSource` mit `visibilitychange`-Listener: bei sichtbar werdender Seite zusätzlich `GET /api/state/snapshot` ziehen, falls SSE-Reconnect länger als 3 s dauert.
- **Kein Wakelock auf Phone** (anders als Tablet): das Display darf bei Inaktivität sleepen. Der Gast soll nicht sein Phone-Akku leerlaufen lassen, nur weil er auf der Party im Hintergrund die DJ-App offen hatte. Wakelock bleibt eine Tablet-Host-Feature, weil der iPad-Host die UI aktiv vor sich liegen hat.

**Anti-Trolling-Schutz** (offen — finale Werte in Implementierung):
- Maximale Gast-Queue-Länge: 5 oder 10? Wenn voll → neue Submissions 429.
- Optionaler Quota-Timeout: wenn Track 15 min in `pending` ohne dass er drangekommen ist → automatisch `markDone`, Slot frei.

### Phase 4b: Library-Build im Admin (Playlist-Picker, additiver Build, Spotify-Status)

**Status: durch.** Was beim Bauen über die ursprüngliche Planung hinaus gelernt wurde, ist unten unter "Spotify-API-Realität (2025/2026)" zusammengefasst — relevant für künftige Erweiterungen.

**Ziel**: Den CLI-Aufruf `npm run build-library -- <uri>` als Primärweg ablösen. Host wählt seine eigenen Spotify-Playlists in `/admin` per Checkbox, baut die Library im Browser, sieht Live-Progress. CLI bleibt als Power-User-Fallback. Build ist **additiv** — bestehende Tracks bleiben unverändert, neue URIs werden angehängt; das schützt vor Datenverlust durch Fehlbedienung und macht Re-Builds quasi gratis (alle BPM-/Mood-/Energy-Edits bleiben automatisch erhalten, weil nichts überschrieben wird).

**Voraussetzung**: PLAN-Phase 3 (Spotify-OAuth) ist durch — wir nutzen den existierenden User-Token statt des Client-Credentials-Flows im CLI. PLAN-Phase 4 (SSE-Infrastruktur) liefert das Pattern für die Build-Progress-Events.

**OAuth-Scope** (`lib/spotify.ts`):
- `SCOPES` um `playlist-read-private` erweitert. `playlist-read-collaborative` ist **nicht** nötig: `/v1/me/playlists` listet auch ohne ihn alle Playlists, an denen der User Collaborator ist.
- `hasScope(name)`-Helper tokenized den space-separated `scope`-String aus `token.json` und prüft **vor** dem Spotify-Call. Fehlt der Scope → Endpoints liefern HTTP 401 `{error: 'reauth_required'}` deterministisch (kein 403-Spotify-Roundtrip nötig). `requireScope(name)`-Wrapper wirft `SpotifyScopeError`, den die Routes auf 401 mappen.
- Re-Auth: `exchangeCodeForToken()` schreibt `token.json` neu mit dem aktualisierten Refresh-Token (verdrängt den alten). Kein manuelles Revoking.
- Helper: `getMe()` (Result pro Prozess gecached für `isOwn`-Check via `currentUser.id === playlist.owner.id`), `getMyPlaylistsPaginated()`, `clearMeCache()` (für Account-Wechsel-Edge-Case).

**Connection-Status-Banner** (`app/admin/ConnectionStatus.tsx`, Server Component):
- Wird in `app/admin/page.tsx` server-seitig befüllt (`Promise.all([loadLibrary(), getSpotifyStatus()])`) — kein extra Browser-Roundtrip.
- Drei Zustände: grün (verbunden + Scope OK + User-Display-Name), orange (verbunden aber Scope fehlt), rot (gar nicht verbunden). Jeweils mit Connect-/Re-Connect-Link auf `/api/spotify/auth`.
- Erklärt im Banner: der Spotify-Token liegt **server-seitig** in `~/.aidj-app/token.json`, nicht im Browser. Eine Browser-Session (Normal vs Inkognito) hat keinen Einfluss auf die Auth — Inkognito war nur Workaround für das OAuth-Cookie-Origin-Problem, nicht für die Auth selbst.

**Build-Logik** (`lib/library-build.ts`, Server-Only):
- Reine Funktionen, Spotify-Fetch wird injiziert: `fetchPlaylistTracks`, `fetchArtistsBulk`, `fetchBpmResilient`, `buildLibraryFromPlaylists({playlistIds, fetchSpotify, bpmKey, existing, onProgress})`.
- CLI und Web-UI teilen sich den Code: CLI injiziert Client-Credentials-Fetch, Web-UI das User-OAuth-`spotifyFetch()`.
- **Additivität**: Build dedupliziert neue Playlist-Tracks gegen URIs in der bestehenden Library; nur **neue** Tracks werden gefetcht + angereichert. `existing.tracks` bleibt 1:1 erhalten, neue hängen hinten dran. Konsequenzen: (a) Mood-Tags/Energy/BPM bleiben trivial bestehen (nichts wird überschrieben), (b) ein versehentlicher Build mit 0 zugänglichen Playlists frisst nicht den Bestand, (c) `builtAt` wird nur aktualisiert, wenn auch wirklich was hinzukam — "Build mit 0 neuen Tracks" sieht nicht aus wie frische Library.
- **BPM-Parallelisierung**: `mapWithConcurrency(tracks, 2, fetchBpmOne)` + 500ms Inter-Sleep pro Worker. Concurrency 2 mit Sleep ist konservativ gegen das undokumentierte GetSongBPM-Free-Limit (~150 req/min).
- **BPM throw-safe**: `fetchBpmOnce` returnt `{bpm, status}`, niemals Throw. `fetchBpmResilient` wrappt mit zwei Retries (`sleep(2000)` → `sleep(4000)`) bei 429 ODER 5xx (Cloudflare-Schutz antwortet bei Burst-Traffic mit 503/HTML statt 429); finaler Fail → `bpm: null`. Status mitprotokolliert.
- **Artists-Lookup 403-Fallback**: Spotify hat im Dev-Mode auch `/v1/artists` eingeschränkt. `fetchArtistsBulk` wirft `ArtistsLookupForbiddenError` bei 403; der Orchestrator fängt das, emittet ein `warning`-Event und fährt mit leerer `artistMap` weiter — Tracks bekommen `spotifyGenres: []`. Genres sind sekundäre Metadata; DJ-Brain (Phase 5) ist auf Moods/Energy/BPM viel angewiesener.
- **Playlist-403-Fallback**: `fetchPlaylistTracks` wirft `PlaylistForbiddenError` bei 403 (Spotify-Dev-Mode oder Playlist-spezifische Sperre); Orchestrator skippt die Playlist, sammelt sie in `skippedPlaylists`, Build crasht nicht.
- Helper-Inline (~15 Zeilen, keine Dependency):
  ```ts
  async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, idx: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }
  ```

**Erwartete Wall-Clock-Zeiten** (Faustregel; reale Latenzen schwanken je nach GetSongBPM-Hit-Rate von 60–80% und Spotify-Dev-Mode-Restriktionen):

| Szenario | Vor Phase 4b | Nach Phase 4b |
|---|---|---|
| Frischer Build, 100 neue Tracks (BPM-Key gesetzt) | ~140 s | ~60 s |
| Frischer Build, 300 neue Tracks (BPM-Key gesetzt) | ~420 s | ~180 s |
| Build mit gemischter Auswahl (50 neue + 50 schon im Bestand) | ~140 s | ~30 s |
| Build mit identischen Playlists (alle Tracks schon im Bestand) | ~115 s | ~2 s |
| Frischer Build ohne BPM-Key | ~10 s | ~5 s |

Hinweise:
- Wenn `/v1/artists` 403't (Dev-Mode), entfällt Phase 2 komplett — der Build wird dadurch sogar schneller, allerdings ohne `spotifyGenres`.
- Die "schon im Bestand"-Tracks werden gar nicht neu angefasst (additiv), nicht nur "BPM preserved" — sie werden im Build-Loop einfach geskippt.

**Neue API-Endpoints — Two-Step-SSE-Pattern**:

`app/api/spotify/status/route.ts` (`GET`):
- Antwort: `{connected, hasPlaylistScope, user: {id, displayName} | null}`. Wird vom ConnectionStatus auch indirekt benutzt (Server Component ruft die `lib/spotify.ts`-Helper direkt) — Endpoint primär für künftige Client-Refreshes.

`app/api/spotify/playlists/route.ts` (`GET`):
- Paginiert `GET /v1/me/playlists?limit=50` durch.
- Antwort: `{playlists: Array<{id, name, ownerId, ownerName, isOwn, trackCount, coverUrl: string | null}>}`. `coverUrl` ist nullable — selbst-erstellte Playlists ohne Cover haben leeres `images`-Array.
- `trackCount` liest `items.total` mit Fallback auf `tracks.total` — Spotify hat das Feld umbenannt (siehe Spotify-API-Realität unten).
- Defensive Null-Checks: `page.items`, `playlist.owner`, `playlist.images` können null sein (gelöschte/migrierte Playlists). Solche Items überspringen statt crashen.
- Fehlender Scope → 401 `{error: 'reauth_required'}` (proaktiv via `hasScope`).

`app/api/library/build/route.ts` (`POST`):
- Body: `{playlistIds: string[]}` mit Base62-ID-Validierung.
- Frühe Auth-Checks: `requireScope('playlist-read-private')` + `/v1/me`-Probe scheitern explizit, bevor ein Job gestartet wird.
- Erzeugt Job-ID, startet Build async im Hintergrund, antwortet sofort mit `{jobId, bpmEnabled}`.
- Job-Singleton in `lib/library-build.ts`: nur ein Build gleichzeitig. Zweiter POST → 409 `{error: 'build_in_progress', jobId: <aktuelle>}` — Caller kann am laufenden Stream attachen statt zu warten.

`app/api/library/build/[jobId]/stream/route.ts` (`GET`, SSE):
- Nativer `EventSource`-Endpoint. Events:
  - `phase` (`{phase: 'playlists'|'artists'|'tracks', message}`)
  - `progress` (`{currentIndex, totalTracks, bpmHits, bpmMisses}`)
  - `track` (jeder fertige `LibraryTrack`)
  - `warning` (`{playlistId?, message}` — übersprungene Playlists, Artists-403-Fallback)
  - `done` (`{trackCount, addedCount, alreadyPresentCount, bpmHits, skippedPlaylists}`)
  - `error` (`{message}`)
- Beim Connect wird der bisherige `eventLog` als Replay rausgepusht (Re-Attach nach Disconnect). Wenn Job schon `done`/`error`: nur Replay, dann Stream-Close.
- `EventEmitter` pro Job. Bei `cancel()` des Streams: nur die Subscription gelöst — der **Job läuft weiter** (Browser-Close mid-Build verliert keinen Fortschritt).
- Mehrere Tabs können denselben Stream attachen.
- Nicht-existierende `jobId` → 404.

`app/api/library/route.ts` (`PUT`) — **Race-Schutz**:
- Vor `saveLibrary()` und nochmal nach Schema-Parse: `libraryBuild.isRunning()` → wenn ja, 409 `{error: 'build_in_progress'}`. Verhindert dass ein Editor-Save mid-Build die Build-Output über- oder weg-schreibt.

**Admin-UI** (`app/admin/PlaylistPicker.tsx`, `'use client'`):

Neue Komponente, unter dem `<ConnectionStatus>`-Banner und über dem `<LibraryEditor>` in `app/admin/page.tsx`. Wird nur gerendert, wenn `connected && hasPlaylistScope` — sonst dominiert der Status-Banner mit Connect-Link.

```
┌─ ConnectionStatus (Server-Component) ──────────────────┐
│ ● Spotify verbunden als markusreuter-de [neu verbinden]│
└────────────────────────────────────────────────────────┘
┌─ Library bauen ─────────────────────────────────┐
│  [Playlists aus Spotify laden]                  │
│  🔍 [Filter…]              ☑ Eigene zuerst      │
│  ☑ Peak Time         (88 Tracks · Markus eigene)│
│  ☐ Warm-Up           (42 Tracks · Markus eigene)│
│  [Library bauen — 1 Playlist, ~88 Tracks]       │
│                                                 │
│  Build-Status (live):                           │
│   Phase: Tracks 47/88 · BPM-Hits 31             │
│   ⚠ Spotify-Artist-API (Bulk) gibt 403 …        │
│   ✓ Strobe — deadmau5 — 128 BPM                 │
└─────────────────────────────────────────────────┘
```

State-Maschine: `idle` → `loading` (GET Playlists) → `picking` (Liste + Filter + Build-Button) → `building` (`POST` liefert `jobId`, dann `new EventSource('/api/library/build/' + jobId + '/stream')`) → `done` (Done-Box: "X neu hinzugefügt · Y schon im Bestand übersprungen · Z BPM-Hits · Library hat jetzt N Tracks", plus Liste der via 403 übersprungenen Playlists mit Owner-Info) → `error`. Die `picking`-Stage bleibt in `done`/`error` weiter sichtbar, sodass der User direkt nochmal builden kann.

**LibraryEditor-Re-Init nach Build-Done**: `LibraryEditor` ist Client Component mit `useState(initialLibrary)`. `router.refresh()` ändert nicht den initialisierten State. → `app/admin/page.tsx` setzt `<LibraryEditor key={library.builtAt ?? 'empty'} initialLibrary={library} />`. Nach Build-Done bumpt `builtAt` (neuer Timestamp), Key ändert sich, React unmount/remount mit den frischen Tracks. `PlaylistPicker` triggert `router.refresh()` im `done`-Listener.

**CLI behalten** (`scripts/build-library.ts`):
- Dünner Wrapper über `lib/library-build.ts` mit Client-Credentials-Fetch.
- Profitiert automatisch von Concurrency + Additivität + 403-Fallbacks.
- **CLI-Limitation**: Client-Credentials liest nur **public** Playlists. Eigene private Playlists nur über `/admin`.

**Edge-Cases**:
- **Sehr lange Builds**: SSE hält UI responsive. Browser-Close mid-Build verliert nichts — Job läuft serverseitig weiter, am Ende landet `library.json` auf Disk.
- **Build-Cancel**: V1 nicht implementiert.
- **Re-attach an laufenden Job**: zweiter Tab macht `POST` mit Selection → 409 + `jobId` zurück → UI attached automatisch am Stream der laufenden Job-ID statt Fehler.
- **Kein `GETSONGBPM_API_KEY`**: Build läuft fast instant, BPMs alle `null`. Done-Status zeigt "ohne BPM-Daten".
- **Editor während Build gespeichert**: PUT /api/library liefert 409 → Editor-UI zeigt die Fehlermeldung.
- **Systematische 429/503 von GetSongBPM**: Track wird nach Backoff-Erschöpfung mit `bpm: null` markiert. Build läuft weiter.
- **Spotify-Dev-Mode-403 auf einzelne Playlists**: Playlist wird übersprungen + in `skippedPlaylists` aufgelistet, mit Owner-Info im Done-Status.
- **Spotify-Dev-Mode-403 auf `/v1/artists`**: Genres bleiben leer, Build läuft mit Warning-Event weiter.
- **Sehr viele Playlists (500+)**: Filter-Input ist Pflicht (im Design), Virtual-Scroll noch nicht nötig.
- **Out-of-Scope für V1**: Build-History, Diff-View, selektives Entfernen einer Playlist aus der Library, Build-Cancel-Button.

#### Spotify-API-Realität (2025/2026) — Lessons Learned

Beim Implementieren von Phase 4b sind mehrere Spotify-Endpoint-Verträge aufgefallen, die in älterer Doku noch anders dokumentiert sind. Wer hier später anfasst, sollte das wissen:

1. **`redirect_uri` muss `127.0.0.1` sein, nicht `localhost`** (Spotify-Policy seit Nov. 2024). Konsequenz: App im Browser über `http://127.0.0.1:3000/...` öffnen, sonst Cookie-Origin-Mismatch beim Callback (Browser sieht `localhost` ≠ `127.0.0.1`).
2. **Playlist-Tracks heißt jetzt `/items` statt `/tracks`**. Der alte Endpoint gibt für neuere/aktualisierte Playlists `403 Forbidden`, für ältere noch 200 — Mischzustand, der mit "funktioniert für manche Playlists" verwirrt. `/items` ist universell. Container-Feld pro Item heißt **`item`** (nicht `track`); Track-Felder (artists, duration_ms, uri, album.images, name, is_local, type) sind identisch.
3. **Playlist-Track-Counter im `/me/playlists`-Response heißt `items.total`** (nicht `tracks.total`).
4. **`/v1/artists` (Bulk-Lookup) gibt im Dev-Mode 403** — Spotify hat das für non-production-Apps gesperrt. Fallback: leere `spotifyGenres` pro Track, Build läuft weiter, Warning ans UI. Production-Mode (Approval-Prozess im Spotify-Dashboard) hebt das vermutlich auf.
5. **Single-Playlist-`/v1/playlists/{id}` (Metadata) funktioniert**, nur `/tracks` als Sub-Resource ist deprecated. Damit kann man Playlist-Namen/-Owner für Diagnose unabhängig vom Track-Endpoint holen.
6. **`/me/playlists`-Response enthält null-Items + null-Sub-Objects** (`owner`, `images`, gelegentlich auch `tracks`/`items`) für gelöschte/migrierte/cover-lose Playlists. Defensiv: alle Sub-Accesses mit `?.` und Defaults.

Future Considerations:
- Wenn Phase 5 (DJ-Brain) Genre-Hinweise braucht, lohnt sich der Production-Mode-Antrag im Spotify-Dashboard ("Request Extension"). Bis dahin reicht der Mood-Tag-Editor + BPM als semantisches Signal.
- Beim Hochziehen weiterer Spotify-Endpoints (Search in Phase 3a, …) immer erst eine Live-Probe gegen den Token machen, bevor Schema-Annahmen aus älteren Doku-Versionen festgeklopft werden.

### Phase 5: DJ-Brain (Vercel AI SDK + Claude)

**Setup, das jetzt fällig wird** (in Phase 0 bewusst ausgelassen):
- Installieren: `ai`, `@ai-sdk/anthropic`.
- `.env.local` ergänzen: `ANTHROPIC_API_KEY=…`.

**`lib/dj-brain.ts`** — Kernlogik:

```ts
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';

const CandidatesSchema = z.object({
  candidates: z.array(z.object({
    trackUri: z.string(),
    reasoning: z.string(), // intern, nicht aufs Tablet
  })).min(3).max(4), // Erstes Element = Top-Pick (Auto-Fallback)
  shouldRefreshMoodQuestion: z.boolean(),
  newMoodQuestion: z.object({
    question: z.string(),
    options: z.array(z.object({ emoji: z.string(), label: z.string(), value: z.string() })).min(3).max(6),
  }).optional(),
});

const DJ_INSTRUCTIONS = `You are an expert party DJ. Propose 3-4 tracks that would each work well as the next song.
Order them by your confidence (first = strongest pick, used as auto-fallback if the crowd doesn't choose).
The candidates should be DIVERSE — different vibes / BPMs / genres — so the crowd has a real choice, not 4 near-duplicates.
Constraints:
- Avoid tracks played in the last 10 tracks.
- BPM transition: prefer ±10 BPM from current track, unless context calls for a deliberate break.
- Respect active playlist filters as hints, not hard rules (unless 3+ playlists are toggled — then narrow harder). Playlists are curated host-defined groups (e.g. "Peak Time", "Closer") — map them to your understanding of the library's actual `spotifyGenres` / mood-tags. Library-Genre-Tags bleiben die Wahrheit; Playlists sind eine UI-Filter-Ebene.
- Negative signals (recent "👎 Nicht das" on tracks with overlapping tags) should de-rank similar tracks.`;

export async function proposeNextCandidates(state: PartyState) {
  return generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: CandidatesSchema,
    // System-Block enthält statische Inhalte: Instructions + Library.
    // Cache-Breakpoint sitzt am Ende der Library — alles davor wird über
    // alle Calls hinweg wiederverwendet (90%+ Token-Ersparnis).
    messages: [
      {
        role: 'system',
        content: [
          { type: 'text', text: DJ_INSTRUCTIONS },
          {
            type: 'text',
            text: `LIBRARY:\n${JSON.stringify(state.library)}`,
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Currently playing: ${JSON.stringify(state.currentTrack)}` },
          { type: 'text', text: `Recent tracks (last 10): ${JSON.stringify(state.history.slice(-10))}` },
          { type: 'text', text: `Current mood question + crowd answers: ${JSON.stringify(state.currentMoodQuestion)}` },
          { type: 'text', text: `Recent button presses (last 5 min, weighted by recency): ${JSON.stringify(state.aggregatedButtonState)}` },
          { type: 'text', text: `Active playlist filters: ${state.activePlaylists.join(', ') || 'none'}` },
          { type: 'text', text: `Time: ${new Date().toLocaleTimeString()}, party started: ${state.partyStartedAt}` },
        ],
      },
    ],
  });
}
```

**Hinweise zum Caching**:
- Property heißt `providerOptions` (nicht `experimental_providerMetadata` — das war ein älterer Vercel-AI-SDK-Name).
- Anthropic-Caching ist **prefix-basiert**: alles bis zum letzten `cacheControl`-Marker wird gecached, alles danach ist Cache-Miss. Daher gehört die Library als letzter statischer Block in den `system`-Slot, dynamische Felder ausschließlich in `user`.
- Cache-TTL ist 5 Minuten (ephemeral). Bei aktiver Party feuert `proposeNextCandidates()` alle paar Minuten → Cache bleibt warm.

**Button-State-Aggregation** (`lib/state.ts`):
- In-Memory Store mit Event-Log aller Button-Presses (timestamp + type + value).
- `aggregatedButtonState()` berechnet recency-weighted Counts: jüngere Klicks zählen mehr (Exponential Decay, z. B. Halbwertszeit 3 Min).
- Speziell: "👎 Nicht das" auf den aktuellen Track → markiert dessen Tags als "downweight" im nächsten Pick-Call.

**Lifecycle pro Track-Slot**:
1. **Neuer Track startet** (oder Party-Start) → Server checkt zuerst die **Gast-Queue** (`lib/guest-queue.ts`, Phase 4a). Wenn `guestQueue.peekNext() !== null` → **Brain-Call überspringen**, stattdessen FIFO-Head als Pseudo-Top-Pick (+ ggf. 1–3 weitere Gast-Tracks falls vorhanden) als "Kandidaten" in den State schreiben. Karten zeigen visuelles "🎤 Gast-Wunsch"-Badge statt LLM-Begründung. Brain-Call findet erst statt, wenn die Queue leer ist — das spart Tokens und erfüllt "AI übernimmt erst, wenn alle Gast-Tracks gespielt/geskippet sind". → 3–4 Kandidaten landen im State → SSE pusht sie ans Tablet + alle Phones → Karten erscheinen.
2. **Crowd tippt eine Karte** → `POST /api/queue/commit { trackUri }` (vom Tablet) ODER `POST /api/guest/submit { trackUri }` (vom Phone, mit Quota-Check). Beim Phone-Tap auf AI-Kandidaten-Karte: der Track wird FIFO ans Ende der Gast-Queue gehängt **und** zählt gegen das 1-Slot-Budget des Gasts. Tablet-Tap dagegen committet sofort den nächsten Slot (Host-Privileg). Status der Karten wechselt zu "committed".
3. **Lock-Window erreicht** (10 s vor Track-Ende): Was als nächstes in die Spotify-Queue gepusht wird, hängt vom Slot-Typ ab — Gast-Slot → FIFO-Head, Brain-Slot → Top-Kandidat (Index 0) oder ggf. die committed-Wahl des Hosts. Karten werden "locked".
4. **Track-Ende / Übergang** → `guestQueue.markDone(uri)` wenn es ein Gast-Track war (Slot frei für den Gast) → springe zu 1.

**Zusätzliche Trigger** (außer dem Normal-Lifecycle):
- "⏭ Skip Jetzt"-Press → `spotify.skip()` jetzt + `guestQueue.markDone(currentTrackUri)` falls Gast-Track + (falls noch nicht committed) FIFO-Head der Gast-Queue ODER Top-Kandidat queueen + sofort neue Kandidaten für den folgenden Slot anfordern. Skip kann sowohl Tablet-DJ als auch Phone-DJ auslösen — Server idempotent gegen Doppel-Skip.
- "👎 Nicht das" auf aktuellen Track → re-rank: `proposeNextCandidates()` erneut aufrufen (override aktuelle Kandidaten, da die unter Umständen ähnliche Tags hatten). Re-rank gilt nur für Brain-Slots, nicht für Gast-Slots — Gast-Wünsche werden nicht durch Mood-Signal neu sortiert.
- Massive Stimmungsänderung (z. B. >5 Mood-Klicks in 30 s, die kontrastreich zur aktuellen Wahl stehen) → re-rank.

**Mood-Frage-Refresh**:
- Default: alle 4 Tracks oder wenn LLM in seinem `shouldRefreshMoodQuestion` Flag `true` zurückgibt.
- Neue Frage + Options werden in den State geschrieben → SSE pusht ans Tablet.

### Phase 6: Glue & Polish

- `app/page.tsx` — Landing mit Buttons: "Connect Spotify", "Wähle Device", "Library-Status", "Start Party".
- `app/admin/page.tsx` — Library-Editor (s. Phase 2).
- `app/history/page.tsx` — Liste was gespielt wurde + welche Mood-Buttons gedrückt waren (für post-mortem "was lief auf der Party?").
- Settings: Mood-Frage-Refresh-Intervall, Pick-Lookahead-Sekunden, Anti-Button-Gewichte tunbar.
- GetSongBPM API-Key beantragen (kostenlos, für Library-Tagging falls noch nicht in Phase 2 erledigt).

## Kritische Dateien (zu erstellen)

| Datei | Phase | Zweck |
|---|---|---|
| `package.json` | 0 | Dependencies + Scripts (`dev`, `build-library`) |
| `next.config.js` | 1 | Image-Domains (Spotify/iTunes CDN) erlauben |
| `lib/mock-data.ts` | 1 | Fake-Tracks + Mood-Fragen für Demo |
| `scripts/fetch-mock-covers.ts` | 1 | Einmaliger iTunes-Search-Call für Cover-URLs der Mock-Tracks |
| `public/manifest.json` | 1 | PWA-Manifest (Fullscreen, Landscape, Background-Color) |
| `app/tablet/page.tsx` | 1 → 4 | Touch-UI für iPad (Phase 1: Mock-State, Phase 4: SSE-State) |
| `app/admin/page.tsx` | 2 | Library-Editor |
| `app/page.tsx` | 6 | Setup/Landing |
| `app/api/spotify/auth/route.ts` | 3 | OAuth start |
| `app/api/spotify/callback/route.ts` | 3 | OAuth callback |
| `app/api/spotify/queue/route.ts` | 3 | Queue control |
| `app/api/spotify/now-playing/route.ts` | 3 | Current track |
| `app/api/state/stream/route.ts` | 4 | SSE endpoint (Track + Kandidaten + Mood + Counts) |
| `app/api/state/button/route.ts` | 4 | Button-Press receiver (Mood / Playlist / Anti) |
| `app/api/queue/commit/route.ts` | 4 | Crowd-Tap auf Kandidaten-Karte → queue track |
| `lib/spotify.ts` | 3 + 4b | Spotify SDK wrapper (Phase 4b: + `playlist-read-private`-Scope, `hasScope`/`requireScope`/`SpotifyScopeError`/`getMe`/`getMyPlaylistsPaginated`/`spotifyFetch` exportiert) |
| `lib/dj-brain.ts` | 5 | Vercel-AI-SDK orchestration |
| `lib/state.ts` | 4 | In-Memory state + button aggregation |
| `lib/library.ts` | 2 | Library load/query |
| `lib/library-build.ts` | 4b | Shared Build-Logik + Job-Registry (Spotify-Fetch injiziert, additiver Build, BPM-Concurrency 2 + 500ms-Inter-Sleep, 429/5xx-Backoff, /items-Endpoint, Playlist-/Artists-403-Fallbacks, EventEmitter pro Job) |
| `scripts/build-library.ts` | 2 + 4b | Library-Build-CLI (Phase 4b: dünner Wrapper über `lib/library-build.ts`) |
| `app/api/spotify/status/route.ts` | 4b | GET Spotify-Verbindungsstatus (connected/scope/user) für ConnectionStatus |
| `app/api/spotify/playlists/route.ts` | 4b | GET eigene + gefolgte User-Playlists für /admin-Picker |
| `app/api/library/build/route.ts` | 4b | POST → `{jobId}` startet Build-Job |
| `app/api/library/build/[jobId]/stream/route.ts` | 4b | GET native EventSource-SSE pro Job |
| `app/admin/ConnectionStatus.tsx` | 4b | Server-Component: Verbindungsstatus-Banner oben in /admin |
| `app/admin/PlaylistPicker.tsx` | 4b | Client-Component: Playlist-Auswahl + Live-Build-Progress |
| `data/library.json` | 2 | Kuratierte Track-Library |
| `.env.local` | 3+5 | API keys (Spotify in Phase 3, Anthropic in Phase 5) |

## Verification

### Verification A: Demo-Stand (nach Phase 1)

Ziel: vorzeigbar an Frau auf iPad, keine externen APIs nötig.

1. **Demo-Setup**: `npm install`, `npm run dev` (für die Demo reicht Dev-Mode; Production-Mode kommt erst in Verification B).
2. **iPad-Test**: Safari auf iPad → `http://<mac-lan-ip>:3000/tablet` → "Zum Home-Bildschirm hinzufügen" → von dort öffnen → Fullscreen ohne Safari-Chrome.
3. **Visueller Sanity-Check**: Cover-Bilder laden alle (keine kaputten Bild-Icons), Layout passt auf iPad in Landscape, Farben/Gradient wirken Party-tauglich.
4. **Karten-Tap (Commit-Verhalten)**: Karte tippen → ausgewählte highlighten, andere ausgrauen, Auswahl bleibt sichtbar **bis zum simulierten Track-Ende**. Re-Tap auf andere Karte ändert den Commit.
5. **Auto-Pick-Demo**: 30 s warten ohne zu tippen → Auto-Pick triggert auf Top-Karte → erst dann erscheinen neue 4 Karten mit Übergangs-Animation.
6. **Mood-Frage**: Mood-Button tippen → Counter-Badge erscheint. Nach 4 Tracks wechselt die Frage.
7. **Playlist-Toggle**: Playlist togglen → visuell aktiv/inaktiv (9 Toggles, 2 Reihen).
8. **Anti-Button**: Skip / Nicht das / Mehr davon → Toast-Feedback erscheint kurz.
9. **Keine Texteingabe**: Versuche irgendwo zu tippen → es darf nirgends ein Eingabefeld aufgehen.
10. **Sieht gut aus? → Frau zeigen.** Wenn Punkte hier scheitern, nicht zu Phase 2 übergehen.

### Verification B: End-to-End-Test (nach Phase 5/6, vor der Party)

0. **Voraussetzungen vorher prüfen**:
   - Spotify-Account ist **Premium** (Free reicht für Queue-API nicht).
   - Spotify-Account ist im Dev-Dashboard als Test-User eingetragen.
   - macOS-Firewall erlaubt eingehende Verbindungen auf Port 3000 (beim ersten App-Start ploppt der Dialog → "Erlauben").
   - Mac und iPad sind im **selben WLAN**.
1. **Setup**: `npm install`, Spotify-App registriert, `.env.local` befüllt (Spotify + Anthropic Keys).
2. **Library bauen**: `npm run build-library -- --playlist spotify:playlist:…` → `data/library.json` enthält 50+ Tracks mit BPM + Genres.
3. **Library taggen**: `npm run dev` → `http://localhost:3000/admin` → 20 Tracks mit Mood-Tags + Energy versehen.
4. **App im Production-Mode starten** (für die echte Party, nicht im Dev-Modus — sonst kostet jede Datei-Änderung den State): `npm run build && npm start`.
5. **Spotify Connect & Audio-Out**:
   - **Empfohlen (Mac-Bluetooth)**: Bluetooth-Speaker mit Mac koppeln (Systemeinstellungen → Bluetooth). Spotify-Desktop-App auf dem Mac öffnen → erscheint automatisch als Connect-Device "MacBook". In unserer App `/devices` listet ihn auf, "MacBook" als Target auswählen. `caffeinate -dis` im Terminal starten (Display + Idle + System wach), damit Mac über die ganze Party nicht in den Sleep geht.
   - **Alternative (Sonos / AVR)**: Connect-Device im selben WLAN → in Spotify-App einmal auswählen → in `/devices` taucht es auf.
6. **Tablet-Test**: iPad öffnet `http://<mac-lan-ip>:3000/tablet` → "Zum Home-Bildschirm hinzufügen" → von dort als Fullscreen-PWA starten (sonst Safari-UI-Chrome im Weg). 3–4 Kandidaten-Karten + Mood/Playlist/Anti-Buttons sichtbar, drückbar. **Sanity-Check: nirgends ein Texteingabe-Feld, auch nicht versteckt**.
7. **First Track**: Manuell einen Track in Spotify starten → App detected via `now-playing` → Kandidaten erscheinen auf Tablet → 10 s vor Ende automatisch Top-Kandidat in Queue → Übergang klappt ohne Lücke.
8. **Kandidaten-Tap-Test**: Während eines Tracks eine Karte tippen → diese Karte wird markiert ("committed"), andere ausgegraut → bei Track-Ende wird genau dieser Track abgespielt.
9. **Re-Pick-Test**: Erst Karte A tippen, dann Karte C tippen → bei Track-Ende läuft C, nicht A.
10. **Skip-Test**: ⏭ Skip Jetzt drücken → aktueller Track stoppt, gewählter Kandidat (oder Top-Pick) startet sofort, neue Kandidaten erscheinen.
11. **Mood-Shift-Test**: 5× hintereinander "🥱 Müde" drücken → bei nächstem `proposeNextCandidates()`-Call sollten die Kandidaten signifikant niedrigere `energyLevel` haben.
12. **Mood-Refresh-Test**: Nach 4 Tracks → neue Frage + Options erscheinen auf Tablet.
13. **Reconnect-Test**: iPad-Bildschirm sleepen lassen (5 min warten oder Power-Button), dann wieder aktivieren → Tablet zeigt nach max. 2 s wieder den aktuellen Stand (Track, Karten, Mood-Frage) — kein veralteter Snapshot, kein Hänger.
14. **Zweites Tablet (Multi-Client)**: Zweites Gerät auf `/tablet` öffnen → bekommt sofort den vollen Snapshot, alle Updates erscheinen synchron auf beiden Geräten.
15. **30-Track-Dauerlauf**: Im Schnelldurchlauf (Skip-Button) 30 Tracks durchrattern → keine Wiederholungen, kein Crash, keine Spotify-Rate-Limit-Errors, Kandidaten bleiben divers.

## Out of Scope für v1

- **Eigenes Beatmatching / Crossfade**: Spotify Connect macht Standard-Übergänge. Echte DJ-Mixe würden Web Playback SDK im Browser brauchen → würde Sonos-Vorteil killen.
- **User-Identification / personalisierte Votes**: Jeder Klick ist anonym und global. Wer mehr will, müsste pro User QR-Code-Auth bauen.
- **Cloud-Hosting**: Bewusst lokal — kein Deploy-Setup, keine Public-OAuth-Redirects.
- **HTTPS im LAN / PWA-Install auf Android**: Setup bleibt simpel — HTTP über LAN-IP, kein mkcert, kein Self-Signed-Cert, kein Tunnel. Konsequenz: Chrome auf Android zeigt keine "App installieren"-Option (Browser-Policy: PWA-Install erfordert HTTPS oder localhost). Android-Gäste laden im Browser-Tab; iOS-Safari erlaubt "Zum Home-Bildschirm" auch über HTTP, das Host-iPad ist also nicht betroffen.
- **Persistente Party-Historie zwischen Sessions**: History lebt im Memory. Optional: am Ende der Party als JSON dumpen.
- **Web Search für Track-Vorschläge außerhalb der Library**: Library ist die Grenze (gewollt — kuratiert = vorhersehbar gut).

## Offene Punkte für Entscheidung beim Bauen

- **Library-Größe**: Wie viele Tracks willst du kuratieren? 100 reicht für 4–5 h Party (~60 Plays); 300+ gibt mehr Variation. Beeinflusst Prompt-Cache-Größe (1 KB pro Track → 300 Tracks = 300 KB, völlig im grünen Bereich für Claude Sonnet).
- **Playlist-Liste**: Heute 9 Playlists hart in `lib/mock-data.ts`. Künftige Erweiterung: aus tatsächlichen Spotify-Playlists des Hosts ableiten (Name 1:1, Tracks als Filter-Hint im LLM-Prompt). Library-Genre-Tags (`spotifyGenres`) bleiben unabhängig davon — Playlists sind eine UI-Filter-Ebene, die der LLM als Hint bekommt.
- **Auswahl Claude-Modell**: Sonnet 4.6 als Default (Geschwindigkeit + Qualität). Falls Latenz zu hoch → Haiku 4.5. Falls Track-Wahl zu vorhersehbar → Opus 4.7.
