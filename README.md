# AIDJ — Party-DJ Tablet App

Touch-only Tablet-App für Hausparties. Du stellst dem System eine kuratierte Track-Library zur Verfügung, Claude wählt während der Party laufend 3–4 passende nächste Tracks vor, Gäste tippen Kandidaten-Karten am iPad an, und Spotify Connect spielt ab. Smartphones der Gäste werden via QR-Code zum Wunschmusik-Kanal.

Das hier ist eine **lokal gehostete App** — keine Cloud, kein Account-Service. Du registrierst eine eigene Spotify-Developer-App, der Server läuft auf deinem Rechner, das iPad und die Phones reden über WLAN mit ihm.

## Status

Reifegrad: **Spotify end-to-end, DJ-Brain noch Random** — Tablet/Phone zeigen echten Spotify-Track, Tap auf eine Kandidaten-Karte queued ihn wirklich. Die Track-Auswahl ist noch zufällig (kein LLM-Reasoning).

- ✅ Tablet-UI (Landscape, 4 Kandidaten-Karten, Mood-Buttons, Playlist-Toggles, Anti-Buttons)
- ✅ Phone-UI (Portrait, Track-Suche, Gast-Queue, Hidden-DJ-Mode via 10× Tap aufs Logo)
- ✅ UA-Routing auf `/` (Phone → `/phone`, sonst → `/tablet`)
- ✅ Library-Editor unter `/admin` (Mood-Tags + Energy taggen)
- ✅ `build-library`-Skript (Spotify-Playlists → `data/library.json` + BPM via GetSongBPM)
- ✅ Spotify-OAuth-Flow + API-Proxy (Queue, Now-Playing, Devices, Transfer-Playback)
- ✅ SSE-Pipeline + Server-State (Multi-Client-Sync, Spotify-Polling, Mood/Playlist serverseitig)
- ✅ Gast-Queue-Server-State (FIFO + 1-Slot-Quota + Idempotenz, Phone-Submission via `/api/guest/submit`)
- 🔧 Claude-DJ-Brain (heute Random-Kandidaten aus Library statt LLM)
- 🔧 Gast-Queue-UI auf dem Tablet (heute nur über SSE-Snapshot sichtbar, kein Badge)
- 🔧 Skip-Button + Lock-Window 10 s vor Track-Ende (kommt mit DJ-Brain)

Vollständige Roadmap mit Begründungen in [PLAN.md](./PLAN.md).

## Voraussetzungen

**Hardware**
- Ein Rechner für den Server (Mac, Windows oder Linux). Bleibt während der Party an und im selben WLAN wie die Gäste-Geräte.
- Bluetooth-Speaker oder Sonos/AVR mit Spotify-Connect-Support.
- Ein iPad (oder Android-Tablet) für die Host-UI an der Bar.

**Accounts**
- **Spotify Premium** — hart erforderlich, Queue-Control ist Premium-only.
- (Optional, später) Anthropic-API-Key — erst relevant, wenn das DJ-Brain-Feature fertig ist.

## Software installieren (nackter Windows/Mac)

Wenn auf dem Rechner noch kein Node und kein Git liegt, brauchst du **zwei** Tools — danach geht alles über die Kommandozeile. Du brauchst weder VS Code noch andere Dev-Tools.

### Windows

1. **Node.js 20 oder neuer** — Installer von https://nodejs.org/ herunterladen ("LTS" empfohlen). Standard-Setup durchklicken; npm ist im Installer enthalten. Optional: "Automatically install necessary tools" abwählen — brauchen wir nicht.
2. **Git** — Installer von https://git-scm.com/download/win herunterladen. Beim Setup-Wizard alle Defaults durchklicken; einzige relevante Frage ist der Default-Editor — wenn dir das egal ist, wähl "Notepad" (vermeidet Vim-Schock).
3. **Terminal** — PowerShell ist auf Windows 10/11 vorinstalliert. `Win` drücken → "PowerShell" tippen → öffnen. Alle weiteren Commands kommen hier rein.
4. **Text-Editor für `.env.local`** — Notepad ist eingebaut und reicht. Falls du was Komfortableres willst: [Notepad++](https://notepad-plus-plus.org/) ist klein und kostenlos.

### macOS

1. **Node.js 20 oder neuer** — entweder Installer von https://nodejs.org/ (LTS), oder via Homebrew: `brew install node` (Homebrew vorher installieren über https://brew.sh/ falls noch nicht da).
2. **Git** — kommt automatisch mit den **Xcode Command Line Tools**. Beim ersten `git`-Aufruf wird macOS dich fragen, ob es die Tools installieren soll — "Install" klicken (ein paar hundert MB). Alternativ vorher direkt: `xcode-select --install` im Terminal.
3. **Terminal** — Terminal.app ist eingebaut (`Cmd+Space` → "Terminal").
4. **Text-Editor für `.env.local`** — TextEdit ist eingebaut, **aber** vorher in den Einstellungen unter "Format" auf "Plain Text" stellen (sonst speichert es RTF und Node versteht die Datei nicht). Komfortable Alternative: https://github.com/jgm/pandoc oder einfach VS Code, falls du es eh installierst.

### Verifikation

Im Terminal/PowerShell prüfen, ob alles da ist:

```
node --version    # sollte v20.x.x oder neuer zeigen
npm --version     # irgendwas ab 10
git --version     # irgendwas ab 2.40
```

Wenn alle drei eine Versionsnummer zurückgeben, ist die Basis fertig.

## Setup

### 1. Repo klonen + Dependencies installieren

```bash
git clone <repo-url> aidj
cd aidj
npm install
```

### 2. Spotify-Developer-App registrieren

Du brauchst eine eigene Spotify-App (Client-ID + Client-Secret) — die App selbst läuft bei dir lokal und Spotify muss wissen, dass sie existiert.

1. Öffne **https://developer.spotify.com/dashboard** und log dich mit deinem **Spotify-Premium-Account** ein.
2. Klick **"Create app"** (oben rechts).
3. Felder ausfüllen:
   - **App name**: `AIDJ` (oder was du magst)
   - **App description**: irgendwas — nicht öffentlich
   - **Website**: leer lassen
   - **Redirect URI**: `http://127.0.0.1:3000/api/spotify/callback` — Spotify akzeptiert `localhost` für neue Apps nicht mehr (Policy-Wechsel 2025), nur Loopback via `127.0.0.1`.
   - **Which API/SDKs are you planning to use**: nur **"Web API"** ankreuzen
4. Terms akzeptieren → **Save**.
5. Auf der App-Seite **Settings** öffnen.
6. **Client ID** und **Client secret** (View client secret) kopieren — gleich gebraucht.
7. (Falls eine andere Person als der App-Owner die App nutzen will) Im Tab **User Management** → **Add new user** den Spotify-Account dieser Person als Test-User eintragen. Die App ist im Development-Mode, nur eingetragene Accounts dürfen sich einloggen (max. 25).

### 3. `.env.local` anlegen

```bash
cp .env.example .env.local
```

In `.env.local` befüllen:

```
SPOTIFY_CLIENT_ID=<aus dem Dashboard>
SPOTIFY_CLIENT_SECRET=<aus dem Dashboard>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback
```

`GETSONGBPM_API_KEY` und `ANTHROPIC_API_KEY` kannst du leer lassen — die brauchst du erst später.

### 4. Spotify-OAuth durchlaufen

```bash
npm run dev
```

Browser auf **http://127.0.0.1:3000/api/spotify/auth** → Consent-Dialog → "Agree". Du landest auf `/admin?spotify=connected`.

Die Tokens (Access + Refresh) liegen jetzt unter `~/.aidj-app/token.json` (auf Windows: `C:\Users\<user>\.aidj-app\token.json`). Diese Datei wandert **nicht** ins Repo — der Refresh-Token gilt nur für dich und nur auf diesem Rechner.

> Wenn du den OAuth-Flow auf einem anderen Rechner wiederholen willst (z.B. Dev-Maschine vs. Party-Maschine): einfach dort `npm run dev` und nochmal `/api/spotify/auth` aufrufen. Token wird lokal pro Rechner gecached, `.env.local` ist portabel.

### 5. Library bauen (optional — für die echte Party)

Für die Mock-Demo kannst du diesen Schritt überspringen; die App hat 15 Beispiel-Tracks eingebaut.

Für echten Betrieb: erstelle eine oder mehrere Spotify-Playlists (in deinem normalen Spotify-Account) mit Tracks, aus denen Claude später wählen darf — z.B. eine "Warm-up", eine "Peak Time", eine "Closer". Insgesamt 100–300 Tracks ergeben gute Variation für 4–5 h Party.

```bash
npm run build-library -- spotify:playlist:abc123 spotify:playlist:def456
```

Schreibt `data/library.json` mit Track-Metadaten + Spotify-Genre-Tags. BPM wird via GetSongBPM-API geholt, wenn `GETSONGBPM_API_KEY` in `.env.local` gesetzt ist (sonst bleibt `bpm: null`).

Beim Re-Build bleiben deine manuell gesetzten `moodTags` und `energyLevel` pro Track-URI erhalten — Editor-Arbeit geht nicht verloren.

GetSongBPM-Key kostenlos beantragen: https://getsongbpm.com/api (Backlink-Pflicht auf deiner Seite, für Privatnutzung egal).

### 6. Tracks taggen

```bash
npm run dev
# Browser: http://localhost:3000/admin
```

Pro Track Mood-Tags (warm-up, peak, banger, feelgood, …) und Energy-Level (1–10) setzen. Spart dir nicht extrem viel — der LLM kommt auch ohne klar — aber gibt ihm zusätzliches Signal für sauberere Übergänge.

## Party-Betrieb

### Vorbereitung am Party-Tag

1. **Produktions-Build** (während der Party läuft die App nicht im Dev-Mode — HMR würde State wegwerfen):
   ```bash
   npm run build
   npm start
   ```
2. **Speaker koppeln**: Bluetooth-Speaker mit Rechner verbinden (oder Sonos/AVR ins gleiche WLAN).
3. **Spotify-Desktop-App** auf dem Rechner öffnen. Sie registriert sich als Connect-Device — die App wählt es später als Playback-Ziel.
4. **Sleep verhindern**: auf macOS `caffeinate -dis` in einem Terminal laufen lassen. Auf Windows ist ein Wakelock-Tool wie [Caffeine](https://www.zhornsoftware.co.uk/caffeine/) oder [Insomnia](https://github.com/PavelDoGreat/Insomnia) der einfachste Weg — App-Einstellungen am Host-Energieplan zu ändern ist nicht vorgesehen.
5. **LAN-IP herausfinden**:
   - macOS: `ipconfig getifaddr en0`
   - Windows: `ipconfig` → IPv4-Adresse von WLAN
6. **Firewall**: Beim ersten App-Start poppt ein Dialog (macOS) bzw. Windows-Defender-Prompt — eingehende Verbindungen auf Port 3000 erlauben.

### iPad einrichten (einmalig)

1. Safari auf dem iPad: `http://<deine-lan-ip>:3000/tablet`
2. Teilen-Button → **"Zum Home-Bildschirm hinzufügen"**
3. Von dort öffnen — startet als Fullscreen-PWA ohne Safari-Chrome.

### Phones der Gäste

QR-Code wird oben rechts auf dem Tablet angezeigt. Gäste scannen, landen auf `/`, werden automatisch nach `/phone` umgeleitet.

### Während der Party

- Tablet zeigt aktuellen Track + 3-4 Kandidaten-Karten. Tap = wird als nächstes gespielt.
- Wenn niemand tippt, übernimmt der Top-Pick automatisch ~10 s vor Track-Ende.
- Mood-Buttons, Playlist-Filter und Anti-Buttons (Skip / 👎 / ❤️) beeinflussen die nächsten Vorschläge.
- Gäste können auf ihren Phones Tracks suchen oder einen der angezeigten Kandidaten claimen — wird FIFO in die Gast-Queue gehängt.

## Wie's funktioniert (Kurzform)

```
iPad  ─┐
       ├─ WLAN ─→  Next.js auf deinem Rechner  ─→  Spotify-API  ─→  Spotify-Connect-Device
Phone ─┘                  ↓                                                ↓
                    Claude-API                                       Bluetooth/AVR/Sonos
                                                                         ↓
                                                                       Speaker
```

Der Server ist die einzige Komponente, die mit Spotify und Claude redet. Tablet und Phones sind reine UI-Frontends, die via WLAN auf ihn zugreifen. Token + State liegen ausschließlich auf dem Server.

Volle Architektur-Diagramme + Begründungen in [PLAN.md](./PLAN.md).

## Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` beim OAuth | Redirect-URI im Dashboard matcht nicht zu `.env.local`. Beide exakt gleich, kein trailing slash. |
| State-Mismatch auf Callback-Seite | Browser blockt Cookies oder Tab-Wechsel mid-Flow. `/api/spotify/auth` neu öffnen. |
| Spotify-Login meldet "User not registered" | Der Account ist nicht als Test-User im Dashboard. User Management → Add new user. |
| `/api/spotify/devices` gibt leeres Array | Spotify-Desktop-App ist nicht offen oder hat sich noch nicht beim Connect-Netz registriert. App öffnen, einen Track manuell starten, dann wieder probieren. |
| Tablet sieht den Server nicht | Falsche LAN-IP, anderes WLAN, oder Firewall. Auf dem Server: `curl http://<lan-ip>:3000/api/lan-url` von einem anderen Gerät im LAN. |
| `next start` bricht ab mit "no build found" | `npm run build` vorher vergessen. |

## Limitations / Out of Scope

- **Kein eigenes Beatmatching** — Spotify Connect macht Standard-Übergänge (Crossfade je nach Spotify-Setting). Echte DJ-Mixe wären nur mit Web Playback SDK möglich, was den Sonos/AVR-Pfad killen würde.
- **Kein User-Login für Gäste** — anonyme UUID im LocalStorage, kein Captcha. Bewusst Low-Friction für Hausparty-Setting.
- **Kein HTTPS im LAN** — heißt: Android-Chrome kann die Phone-UI nicht als PWA installieren (Browser-Policy). iOS-Safari ist OK auch über HTTP. Android-Gäste laden im Browser-Tab.
- **Keine persistente History zwischen Sessions** — State lebt im Memory des Node-Prozesses. Server-Restart = neue Party.
- **Kein Cloud-Hosting vorgesehen** — bewusst lokal. Wer das in die Cloud bringen will, muss OAuth-Redirect, State-Persistenz und Multi-Tenant-Auth selbst durchdenken.

## Datei-Struktur

```
app/             Next.js App Router (UI + API Routes)
  tablet/        Tablet-Frontend (Landscape, touch-only)
  phone/         Phone-Frontend (Portrait, Gast + Hidden-DJ)
  admin/         Library-Editor
  api/
    lan-url/     LAN-IP-Detection für QR-Code
    library/     Library load/save
    spotify/     OAuth + Proxy (auth, callback, devices, queue, now-playing)
    state/       SSE-Stream + Button-Mutations
    queue/       Candidate-Commit (→ Spotify Queue, Host-Privileg)
    guest/       Phone-Submit (FIFO-Queue + 1-Slot-Quota pro Gast)
components/      Geteilte Touch-Komponenten + phone/-Untermodule
lib/             mock-data, library-schema/library (fs),
                 spotify.ts (Token-Storage + Wrapper),
                 state.ts (Server-State-Singleton + EventEmitter),
                 server-state-types.ts (Wire-Format, client-safe),
                 use-server-state.ts (Client-Hook auf EventSource),
                 guest-queue.ts (FIFO + Mutex + Quota für Phone-Submissions),
                 phone/ (guest-id, guest-name, dj-mode)
data/            mock-covers.json, library.json
scripts/         fetch-mock-covers.ts, build-library.ts
public/          PWA-Manifest, Icons
PLAN.md          Vollständiger Implementationsplan + Phasen-Reihenfolge
AGENTS.md        Next.js-Versionshinweise für AI-Coding-Agents
CLAUDE.md        Repo-Onboarding für Claude Code
```

## Mitarbeit / AI-Agents

Diese Codebase nutzt eine Next.js-Version mit Breaking Changes gegenüber den meisten Trainingsständen. Vor dem Editieren: [AGENTS.md](./AGENTS.md) lesen. Für Claude Code: [CLAUDE.md](./CLAUDE.md) ist der Einstiegspunkt.
