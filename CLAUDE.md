@AGENTS.md

# AIDJ — Repo-Onboarding für Claude Code

Touch-only Tablet-App für Partys: ein LLM (Gemini oder Claude — siehe DJ-Brain unten) wählt Tracks vor, Crowd tippt auf iPad-Karten, Spotify Connect spielt ab.

## Heutiger Stand

End-to-end spielbar. Tablet/Phone hängen an `lib/state.ts` (5-s-Spotify-Polling, EventEmitter-Pub-Sub, Multi-Client-Sync; Singleton lebt auf `globalThis` damit Dev-HMR den State nicht verliert). Kandidaten kommen vom DJ-Brain (`lib/dj-brain.ts`) — Provider-Auswahl via `lib/llm-provider.ts` (Gemini 2.5 Flash bevorzugt, Claude Sonnet 4.6 als Fallback), beide via Vercel AI SDK + `generateObject`. Heuristik-Fallback wenn kein LLM-Key gesetzt ist (BPM-Match ±10, Energy-/Mood-/Camelot-Key-Kontinuität zum laufenden Track, Tag-Overlap-Penalties aus 👎/❤️, History-Exclusion). DJ-mäßiges Mixing: beide Pfade planen den Übergang relativ zum laufenden Track — Kandidat #1 (der Auto-Pick) schließt per BPM-/Energy-Stufe + harmonisch kompatibler Camelot-Tonart sauber an, #2-#4 bleiben bewusst divers für echte Crowd-Auswahl. (Kein Audio-Crossfade — Spotify Connect kann nur einen Stream, also reine Auswahl-Glättung, kein Ineinander-Blenden.) Cooldown-Filter sperrt Tracks, die innerhalb `settings.cooldownMinutes` (default 2 h) liefen — Gast-Wünsche umgehen ihn. Tablet-Tap committet direkt in die Spotify-Queue (`/api/queue/commit`, Host-Privileg); Phone-Tap geht durch die Gast-Queue (`/api/guest/submit`) mit FIFO + 1-Slot-Quota + Idempotenz + Max-10-pending + 15-min-Pending-Timeout (lazy-sweep). Track-Lifecycle (pending → playing → done) wird automatisch beim Spotify-Track-Wechsel gesetzt. Lock-Window pusht ~10 s vor Track-Ende den Auto-Pick (committed-Wahl oder Top-Kandidat) in die Spotify-Queue. Skip ist echt (`/api/state/skip` → `spotify.skipToNext()`). 👎/❤️ + Mood-Shift triggern Brain-Re-Rank. `/admin` zeigt Spotify-ConnectionStatus + Brain-Provider-Live-Badge + Cooldown-Slider + Playlist-Picker (additiver Library-Build via SSE-Stream) + LibraryEditor mit Auto-Tag-Button (LLM vergibt `moodTags` + broad-umbrella `genres` + `energyLevel` und schätzt zusätzlich `bpm` (nur Lückenfüller — echter GetSongBPM-Wert hat Vorrang) + `camelotKey` in Camelot-Notation fürs Harmonic Mixing; streamt Progress pro Batch, Concurrency 10, vocabulary-hint sorgt für Tag-Konsistenz; User reviewt + korrigiert (Key-Spalte editierbar) + speichert). `/history` ist die Post-Mortem-Page. Phone-Suche trifft `/api/search` (Library + Spotify Web-Search gemerged, LRU-Cache 60 s); Phone darf einen zweiten Track stagen während der eigene Slot noch belegt ist (Submit-CTA gated, Suche bleibt aktiv).

## Spotify-API-Realität (2025/2026)

Diese Endpoint-Verträge sind Stand 2026 und teils anders als in älterer Doku. Wer hier später anfasst, sollte das wissen:

1. **`redirect_uri` muss `127.0.0.1` sein, nicht `localhost`** (Spotify-Policy seit Nov. 2024). App im Browser über `http://127.0.0.1:3000/...` öffnen, sonst Cookie-Origin-Mismatch beim OAuth-Callback.
2. **Playlist-Tracks heißt `/v1/playlists/{id}/items` statt `/tracks`**. Der alte Endpoint gibt für neuere Playlists `403`, für ältere noch 200 — Mischzustand. `/items` ist universell. Container-Feld pro Item ist `item` (Legacy: `track`); Track-Felder identisch. `type === 'track'` filtert Podcast-Episoden raus.
3. **Track-Counter im `/me/playlists`-Response heißt `items.total`** (nicht `tracks.total`).
4. **`/v1/artists` (Bulk-Lookup) gibt im Dev-Mode 403** — kein Workaround außer Production-Mode-Approval. Build fängt das ab und läuft mit leerem `spotifyGenres` weiter.
5. **`/v1/playlists/{id}` (Single-Playlist-Metadata) funktioniert** — nur `/tracks` als Sub-Resource ist tot. Für Diagnose nutzbar.
6. **`/me/playlists` enthält null-Items + null-Sub-Objects** (`owner`, `images`, gelegentlich `tracks`) für gelöschte/migrierte/cover-lose Playlists. Defensiv mit `?.` und Defaults zugreifen.

Beim Anfassen neuer Spotify-Endpoints **erst live proben**, bevor man Schemas hardcodet.

## Harte Regeln

- **Keine Texteingabe im Tablet-UI.** Keine `<input>`, keine `<textarea>`, keine Suchleiste, kein Volume-Slider, kein Login auf dem iPad. Ausnahme: die Search-Box auf `/phone` ist bewusst da.
- **iPad-Ziel-Layout: Landscape 1024×768.** Portrait-Fallback per `@media (orientation: portrait)`, aber Landscape ist primär.
- **Touch-Targets min. 120×120 px**, Kandidaten-Karten min. 200×240 px. Kein Hover-State.
- **`next start` während der Party, nicht `next dev`** — State liegt nur im Memory. Der `globalThis`-Stash in `lib/state.ts` hilft im Dev-Modus den HMR zu überleben, aber Production-Mode ist robuster.
- **Mood-Tags sind free-form Strings** — kein hardcoded Enum, das LLM beim Auto-Tagging vergibt sie selbst. Konsistenz kommt aus dem Vocabulary-Hint im Prompt (top-30 bisheriger Tags wird dem Modell mitgegeben). Normalisierung: `trim().toLowerCase()` im Schema, sonst kein Lock-In.
- **Genres sind technisch free-form (Schema), praktisch aber auf ein broad-umbrella-Set gesteuert.** Der Auto-Tag-Prompt gibt eine kanonische Liste grober Genres vor (pop, hip-hop, house, techno, electronic, edm, rock, indie, r&b, soul, funk, disco, reggae, dancehall, latin, afrobeats, jazz, classical, metal, punk, country, schlager, ambient) und weist das LLM an, hyper-spezifische Sub-Genres **nach oben aufs Dach zu kollabieren** (z. B. trap/drill/boom-bap → hip-hop, deep-house/tech-house → house), 1-2 pro Track. Das Schema erzwingt das nicht (kein Enum-Lock-In), nur der Prompt — wer das Vokabular ändern will, fasst den Prompt in `app/api/library/auto-tag/route.ts` an. Normalisierung wie Mood-Tags: `trim().toLowerCase()`.
- **Camelot-Keys sind validierte Strings**, kein free-form: Format `<1-12><A|B>` (z. B. `8A`), upper-cased im Schema. Vom Auto-Tag-LLM geschätzt, im Editor manuell korrigierbar.
- **Spotify-Account muss Premium sein** — Queue-Control ist Premium-only. Mit Free läuft die App nicht.

## Secrets

`.env.local` ist über `.gitignore` ausgeschlossen. **Nie committen.** Erwartete Variablen:
```
SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI
GOOGLE_GENERATIVE_AI_API_KEY  (oder)  ANTHROPIC_API_KEY   # Beide optional; ohne läuft Heuristik. Auto-Tag braucht zwingend einen Key.
GETSONGBPM_API_KEY                                        # optional, nur für BPM-Lookups (Backlink-Pflicht, README erklärt)
```
Spotify-Refresh-Token wird in `~/.aidj-app/token.json` mit `chmod 0600` gespeichert — nicht im Repo. Host-Settings (Cooldown) liegen in `~/.aidj-app/settings.json`, gleiches Atomic-Write-Muster.

## Dev

```bash
npm install
npm run dev            # http://127.0.0.1:3000  (Root sniffed UA → /tablet oder /phone)
npm run build          # Produktion (vor der Party)
npm start              # Produktions-Server, State persistiert über Lifetime des Prozesses
npm run build-library -- <playlist-uri> [<playlist-uri> ...]
                       # Power-User-Fallback (CLI, nur public Playlists).
                       # Primärer Weg: /admin → "Playlists aus Spotify laden".
                       # Braucht SPOTIFY_CLIENT_ID/SECRET in .env.local; GETSONGBPM_API_KEY optional.
```

**Browser-URL beim OAuth-Flow**: Spotify erlaubt seit Nov. 2024 kein `localhost` mehr als Redirect-URI — nur `127.0.0.1` (oder HTTPS). Konsequenz: die App im Browser über `http://127.0.0.1:3000/...` öffnen, nicht über `localhost:3000/...`, sonst Cookie-Origin-Mismatch beim OAuth-Callback. `SPOTIFY_REDIRECT_URI` muss zum eingetragenen Eintrag im Spotify-Dashboard passen.

## Codebase-Layout

```
app/             Root-Page (UA-Sniff → /tablet | /phone) + Layout
  tablet/        Tablet-Frontend (das, was auf dem iPad läuft)
  phone/         Phone-Frontend (Portrait, User-Mode + DJ-Mode-Hidden-Tap-Unlock)
  admin/         ConnectionStatus + BrainStatus + CooldownSetting + PlaylistPicker + LibraryEditor (mit Auto-Tag)
  history/       Post-Mortem-Page
  api/
    lan-url/     LAN-IP-Detection für QR-Code
    library/     Library load/save (PUT mit 409-Race-Schutz bei laufendem Build)
                 build/{POST,[jobId]/stream} (Two-Step-SSE-Build-Pipeline)
                 auto-tag (POST liefert SSE-Stream: moodTags + genres + energyLevel
                           + geschätzte bpm + camelotKey, Concurrency 10, 429-Retry,
                           sized für ~2000 Tracks)
    search/      Phone-Suche (Library + Spotify-Web-Search gemerged, LRU 60 s)
    settings/    GET/PUT Host-Settings (Cooldown-Minuten), persistiert via lib/settings.ts
    spotify/     OAuth (auth, callback) + Proxy (devices, select-device, queue, now-playing)
                 + status, playlists
    state/       stream (SSE) + button (mood/playlist/anti) + skip
    queue/       commit (Tablet-Tap → committedId, Host-Privileg) + remove (Wunsch-Löschen)
    guest/       submit (Phone-Tap → FIFO-Gast-Queue mit 1-Slot-Quota)
components/      NowPlayingBar, NextUpCandidates, MoodSection, PlaylistModal, AntiButtons, WifiQrCode
  phone/         PhoneTopBar, NowPlayingCard, HeartbeatBadge, GuestQueueList, …
lib/             mock-data.ts (Mock-Tracks + Mood-Fragen + 9 UI-Playlist-Labels)
                 library-schema.ts (Zod, Client-Safe; moodTags/genres = free-form strings;
                                    camelotKey = Camelot-Tonart "8A"/"11B" fürs Harmonic Mixing, nullable)
                 library.ts (fs-Wrapper, Server-Only)
                 library-build.ts (Shared Build-Logik + Job-Registry, Server-Only)
                 settings.ts (Host-Settings in ~/.aidj-app/settings.json, Server-Only)
                 spotify.ts (Token-Storage in ~/.aidj-app/ + Wrapper + Scopes, Server-Only)
                 state.ts (Party-State-Singleton via globalThis-Stash + EventEmitter
                           + 5s-Polling + Cooldown-Filter, Server-Only)
                 guest-queue.ts (FIFO + Mutex + Quota + 15-min-Pending-Timeout, Server-Only)
                 server-state-types.ts (SSE-Wire-Format inkl. brain-Status, Client-Safe)
                 use-server-state.ts ('use client'-Hook auf EventSource, host|guest-Modi)
                 dj-brain.ts (LLM-Kandidaten + Heuristik-Fallback, Server-Only)
                 llm-provider.ts (pickModel: Gemini → Anthropic → null, Server-Only)
                 phone/ (guest-id, guest-name, dj-mode)
data/            mock-covers.json, library.json (kuratierte Track-Library für DJ-Brain)
scripts/         fetch-mock-covers.ts, build-library.ts (CLI-Fallback)
public/          PWA-Manifest, Icons
```

## Next.js-Version

Diese Version hat Breaking Changes gegenüber Training-Daten — siehe AGENTS.md. Bevor du eine Next.js-API benutzt, die du "kennst", check `node_modules/next/dist/docs/` oder das aktuelle Verhalten im Code.
