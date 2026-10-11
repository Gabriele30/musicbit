# Historical development notes

These notes preserve earlier milestones and laboratory commands. Some descriptions refer to earlier implementations. Use the root README and [current architecture](architecture.md) for the supported application.

PWA musicale personale self-hosted, mobile-first, con React, Vite e Fastify.
Un solo `HTMLAudioElement` gestisce l’intera sessione tra Home, Player, Cerca, Libreria,
Coda e Diagnostica. Il catalogo YouTube Music offre ricerca, dettagli, Play e
aggiunta alla coda; il backend risolve gli stream, preferisce AAC/m4a e serve
`GET/HEAD /api/audio/:id` con HTTP Range.

La Home mostra un feed reale di brani/album/artisti, ascolti recenti, playlist e
artisti seguiti. Le pagine artista includono brani popolari, discografia e artisti
simili; album e brani sono ricercabili e riproducibili. Le playlist personali
supportano creazione, rinomina, riordino, rimozione e riproduzione sequenziale/casuale.

La navigazione principale ha tre sezioni: Home, Cerca e Libreria. Il mini-player
apre il player a schermo intero su mobile; la barra del player dà accesso alla
coda. Su desktop sono disponibili barra laterale e mini-player inferiore.
Artisti e album hanno pagine dedicate e un menu per le azioni secondarie.
Diagnostica e istruzioni PWA sono nelle impostazioni; le demo del player sono
accessibili esplicitamente con `?screen=player&demo=1`.

Preferiti, playlist, album salvati, artisti seguiti, cronologia, coda, posizione,
ripetizione e impostazione autoplay sono salvati sul
dispositivo. Riaprire l’app ripristina la sessione in pausa, senza caricare audio.
I risultati di ricerca restano disponibili navigando tra le schermate. Il mini-player
mobile resta sopra la navigazione; ripetizione e mescolamento dei prossimi brani
sono disponibili. L’autoplay prepara in anticipo brani simili e continua al termine
della coda; è disattivabile dalla schermata Coda. Non avvia l’audio al reload.
**Libreria e interfaccia offline non sono download musicali.**

Audit e verifiche dell’11 ottobre 2026: [criticità, correzioni e priorità](product-audit.md).
La riproduzione reale tramite proxy è stata verificata in Chromium e WebKit desktop;
iOS fisico, blocco schermo e sessioni lunghe con questo backend restano da verificare.
Non sono implementati login, sincronizzazione tra dispositivi, download offline,
testi sincronizzati, gapless/crossfade o controllo di dispositivi remoti.
Le sezioni M1–M5 sotto descrivono lo storico e i laboratori separati, non il percorso
di riproduzione attuale dell’app principale.

## Verificare il player attuale

`pnpm check` esegue lint, tipi, unit test e build. `pnpm test:e2e` verifica l’app
production in Chromium e WebKit con audio PCM locale. `pnpm smoke:audio`, dopo
la build, avvia un’API temporanea e verifica riproduzione/seek di uno stream reale
nei due browser; salva solo diagnostica in `artifacts/audio-live-smoke.json`.
Non fa parte della CI deterministica. `AUDIO_SMOKE_VIDEO_ID` cambia il video di prova.
`node scripts/music-experience-smoke.mjs` verifica anche Home, ricerca artista,
discografia, suggerimenti e audio nell’interfaccia con il catalogo reale. Richiede
l’app attiva; `MUSICBIT_SMOKE_URL` cambia l’indirizzo (default `http://127.0.0.1:4705`).

Se Windows riserva le porte E2E predefinite, usare porte libere senza modificare il sistema:

```powershell
$env:MUSICBIT_E2E_PORT='4704'
$env:MUSICBIT_PLAYBACK_E2E_PORT='4706'
$env:MUSICBIT_YOUTUBE_E2E_PORT='4708'
pnpm test:e2e --workers=4
```

## Laboratorio YouTube playback M5

Analisi della versione installata `youtubei.js@18.1.0`, provider sperimentale
disattivabile, ricerca sul catalogo **YouTube Music**, diagnostica formati/validità,
cache dei descrittori, timeout/cancellazione e un audio persistente riusato da M4.
Il player principale rimane invariato. Nessun decipher, token anti-bot, login,
download permanente o proxy media.

**Esito:** nessuno stream diretto YouTube verificato: mancano permessi documentati
per l'accesso diretto, quindi `/player` non viene contattato dal provider M5.
Il controllo separato con iframe ufficiale visibile ha riprodotto Carefree
in Chromium foreground (click → stato playing 1,30 s). Non dimostra il motore
YouTube.js, lo schermo bloccato o Safari iOS. Il catalogo non è stato sostituito.
[Report tecnico e fattibilità](youtube-playback-feasibility.md).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm experiment:youtube
```

Apri `http://127.0.0.1:4183/__youtube/`. Il laboratorio serve UI/API autonomamente.
Per iPhone, con CA/certificato M2 già validi e attendibili sul dispositivo:

```powershell
$env:YOUTUBE_PLAYBACK_LAB_HTTPS = 'true'
pnpm experiment:youtube
```

Apri `https://<IP-LAN>:4463/__youtube/` (questo PC: **192.168.1.100**).
Manifest separato, senza SW/offline. La sorgente diretta è disattivata per default;
il player ufficiale viene caricato solo esplicitamente. Non mettere permessi
fittizi nella configurazione per sbloccare Play.
[Configurazione dei permessi e checklist iPhone](youtube-playback-ios-checklist.md),
[HTTPS e certificati](ios-https.md). Ctrl+C arresta il lab.

`pnpm check`, `pnpm test:e2e`; `pnpm benchmark:youtube` misura il catalogo reale
cold/warm e riporta separatamente i blocchi della sorgente. Il benchmark con
permessi reali può misurare stream e riproduzione; senza permessi quei valori
sono null. PowerShell `$env:YOUTUBE_OFFICIAL_CONTROL='true'` abilita il controllo
iframe nel benchmark, distinto dal successo nativo. Risultati salvati in
`docs/performance/m5-live.json`. `pnpm smoke:youtube:https` verifica dal PC il lab
HTTPS attivo (non il dispositivo fisico).

## Laboratorio playback M4

`PlaybackProvider` separato dal catalogo: disponibilità, formato, URL, validità,
permesso, cache TTL, deduplicazione, timeout e cancellazione. Ricerca → selezione
→ risoluzione → preparazione facoltativa → Play con un solo audio persistente.
Le demo sono autorizzate; i risultati YouTube restano metadati e restituiscono
`NO_AUTHORIZED_SOURCE` senza tentare estrazioni.

**Player principale invariato:** il confronto desktop non dimostra benefici che
ne giustifichino la sostituzione. Mediana click→playing: principale diretto 256,8 ms,
lab con cache fredda 259,6 ms; preparati 14,7 e 14,8 ms, dopo circa 216 e 204 ms
di preparazione. Non sono misure al suono su iPhone.
[Report, p95 e limiti](playback-feasibility.md).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm experiment:playback
```

Apri `http://127.0.0.1:4181/__playback/`. Il lab serve UI e API autonomamente,
senza `pnpm start`. Per HTTPS LAN, con i certificati generati come descritto
sotto, arresta il lab HTTP e avvia:

```powershell
$env:PLAYBACK_LAB_HTTPS = 'true'
pnpm experiment:playback
```

Debian: `PLAYBACK_LAB_HTTPS=true pnpm experiment:playback`.
Apri `https://<IP-LAN>:4453/__playback/` (su questo PC **192.168.1.100**).
Riusa la CA M2, senza modifiche automatiche alla fiducia. Porta 4453,
raggiungibilità e fiducia vanno verificate sull'iPhone. Manifest separato, senza
SW/offline. [Procedura fisica M4](playback-ios-checklist.md).
Ctrl+C ferma il lab; `Remove-Item Env:PLAYBACK_LAB_HTTPS` ripristina il default
per i comandi PowerShell successivi.

`.env.example`: `PLAYBACK_TTL_MS` (60000), `PLAYBACK_TIMEOUT_MS` (10000),
`PLAYBACK_LAB_HTTPS` e `PLAYBACK_LAB_PORT` opzionale. Il comando legge `.env`;
la shell ha precedenza. Il lab non è pubblicato nei container di produzione
e non modifica `/api/tracks` o `/api/search` principali.

Con `pnpm start` attivo, `pnpm benchmark:playback` confronta i due percorsi,
cinque campioni/scenario, salvando `docs/performance/m4-live.json`.
Imposta `PLAYBACK_BENCHMARK_LABEL` per conservare report distinti.
`pnpm smoke:playback:https` verifica il lab HTTPS attivo; per l'IP LAN imposta
`PLAYBACK_HTTPS_URL=https://<IP-LAN>:4453`. Probe reali esclusi dalla CI.

## Cerca: catalogo M3

Apri **Cerca** oppure `/?screen=search`, scrivi almeno due caratteri e scegli
Brani, Artisti o Album. Debounce 350 ms; tocca un risultato per i dettagli e,
negli album, l’elenco dei brani. Tutti sono marcati **solo catalogo**, senza Play
o aggiunta alla coda. Il collegamento esterno apre YouTube Music. Le tre demo
autorizzate continuano a suonare mentre navighi; il motore audio M2 è invariato.

La libreria usa un’API privata non ufficiale: disponibilità e risultati possono
cambiare. Configurazione `.env` e Compose: `YOUTUBE_CATALOG_ENABLED=false` disabilita
il provider; `CATALOG_TTL_MS=300000` e `CATALOG_TIMEOUT_MS=10000` regolano cache e
deadline. Nessuna chiamata YouTube viene fatta all’avvio o aprendo il solo Player.
La cache è in memoria, limitata a 200 chiavi, con deduplicazione e cancellazione;
non è una libreria musicale offline. Le miniature vengono caricate direttamente
dal browser senza referrer. Consulta [API e architettura](catalog.md) e
[limiti e conformità](catalog-compliance.md).

```sh
# Dopo pnpm build; contatta il servizio reale, escluso dalla CI
pnpm benchmark:catalog
# Con pnpm start attivo, prova UI + provider reali + continuità audio demo:
pnpm smoke:catalog
```

Benchmark locale del 10 ottobre: p50 HTTP senza cache **444–512 ms**, con cache
**1–2 ms**, cinque campioni per tipo. Definizione di freddo, p95 e dati grezzi in
[catalog-performance.md](catalog-performance.md). Non include debounce,
rete dell’iPhone, miniature o tempo al suono.

M2 mantiene il percorso nativo `src/load/play`, aggiunge preparazione **esplicita**
della traccia corrente, timeout/cancellazione e misure API, rete, buffer e lifecycle.
Apri `/?screen=diagnostics` per la diagnostica mobile con controlli ed export JSON.
Il comando **Prepara traccia** ricarica dall’inizio e può scaricare l’intero MP3:
il browser decide quanto precaricare e può ignorare il suggerimento su iOS.

La prima misura M1 ripetuta ha rilevato 7,60 s click→playing, di cui circa 7,27 s
nella fase proxy del browser. Con traccia preparata, tre campioni desktop M2
hanno dato **13,7–15,5 ms**, preceduti da **207,5–275,2 ms di preparazione**.
Rete/cache di sistema non controllate: questi risultati **non validano la soglia
0,5–1,5 s su iPhone**. Dati, fasi e limiti in [performance.md](performance.md).

## HTTPS per la prova iPhone

È disponibile un server HTTPS locale con CA dedicata, senza Docker e senza
modificare automaticamente la fiducia dei dispositivi:

```sh
pnpm build
pnpm start
# In un secondo terminale:
pnpm test:https --share-ca
```

Lo script stampa gli URL LAN sulla porta **4443**. L’opzione `--share-ca` espone
**solo il certificato pubblico** sulla 4444 per installarlo su iPhone. Installa
e abilita la fiducia completa della CA sul telefono, quindi apri l’URL HTTPS
senza avvisi TLS. Procedura esatta, firewall, rimozione CA e alternativa Tailscale
in [ios-https.md](ios-https.md). Il PC deve restare acceso; la raggiungibilità
dal telefono va verificata sul telefono.

Su questo PC è stato verificato `https://192.168.1.100:4443` da desktop con controllo
CA/SAN e service worker. L’utente ha poi confermato i test iPhone M2 elencati sopra.
Tailscale è disponibile, ma Serve risulta disabilitato: l’abilitazione
amministrativa è ancora da completare. Dopo una nuova build chiudi e riapri tutti
i client PWA/Safari per ricevere l’aggiornamento, senza interrompere l’audio durante
un ascolto. Verifica il badge **M3**, poi apri Cerca.

## Esperimenti e misurazioni M2

Con `pnpm start` attivo, `pnpm benchmark` misura tre avvii reali Chromium e salva
JSON in `docs/performance/manual.json`. Non usa una cache HTTP o il service worker.
Per evitare di sovrascrivere un report, cambia `BENCHMARK_LABEL` (variabile di shell).

```powershell
$env:BENCHMARK_LABEL = 'mia-rete-prepared'
$env:BENCHMARK_PREPARE = '1'
pnpm benchmark
Remove-Item Env:BENCHMARK_PREPARE
```

`BENCHMARK_RUNS` accetta 1–20. Su Debian usa
`BENCHMARK_LABEL=mia-rete BENCHMARK_PREPARE=1 pnpm benchmark`.
`pnpm smoke:https` verifica HTTPS con la CA locale; richiede `pnpm test:https`
attivo. Per verificare l’IP LAN imposta `MUSICBIT_HTTPS_URL=https://<IP-LAN>:4443`.

Il laboratorio continuo HLS richiede **FFmpeg e ffprobe nel PATH** (oppure
`FFMPEG_PATH`/`FFPROBE_PATH` come variabili di shell):

```sh
pnpm experiment:hls
# In un altro terminale, con HTTPS di test attivo:
# https://<IP-LAN>:4443/__hls/
```

Genera AAC live da toni originali per massimo 5 minuti, su porta loopback 4180;
Ctrl+C ferma server/encoder. Nessun MP3 remoto viene convertito. La pagina usa
solo HLS nativo e segnala i browser che non lo dichiarano. `pnpm smoke:hls`
esegue una prova server autonoma di circa 15 secondi: rolling playlist,
continuità PTS e decodifica, senza provare l’audio su iPhone. Ferma prima un
eventuale laboratorio sulla stessa porta. Analisi e limiti in [hls-feasibility.md](hls-feasibility.md).

## Requisiti e avvio locale

Node.js **24.x** (verificato con 24.14.0), pnpm **11.25.0**. Docker è facoltativo.
Installa pnpm se manca: `npm install --global pnpm@11.25.0`.

Dalla radice del repository, su Windows PowerShell:

```powershell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

Su Debian/macOS sostituisci la copia con `cp .env.example .env`. Copia solo al
primo avvio, per non sovrascrivere una configurazione esistente.

- Interfaccia: <http://localhost:4175>.
- API: <http://127.0.0.1:3001/health> e <http://127.0.0.1:3001/api/tracks>.
- `pnpm dev` compila shared e avvia Vite/Fastify in watch. Ctrl+C arresta entrambi.
- Vite inoltra `/api/*` e `/health` all’API; nessun CORS richiesto.
- Il file `.env` in radice è letto da API e Vite. `API_PROXY_TARGET` configura il
  proxy; il browser usa URL relativi. API_PORT e target proxy devono concordare.
- Porte: 4175 sviluppo (`WEB_DEV_PORT`), 4173 preview, 3001 API (`API_PORT`).
  La 4175 evita le riserve Hyper-V/Windows osservate intorno alla porta 5173.

Il service worker è disattivato in sviluppo. Per verificare la **PWA production**:

```sh
pnpm build
pnpm start
```

Apri <http://localhost:4173>. `start` esegue API compilata e Vite preview, che serve
solo per verifica locale. `localhost` è un contesto sicuro sul desktop; l’IP LAN
in HTTP non lo è sul telefono. Per provare la PWA su iPhone usa HTTPS attendibile.

## Build, lint e test

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

`check` esegue ESLint, typecheck, Vitest e build. Gli E2E richiedono una build
aggiornata: esegui prima `pnpm build` se non hai eseguito `check`. Playwright
avvia l’API e un host locale della build production sulla porta 4174, che serve
fixture WAV tramite HTTP reale (necessario per la pipeline media nativa WebKit).
Avvia anche il laboratorio di test sulla 4182 con fixture PCM originali.
Riutilizza solo un’eventuale API locale già attiva; in CI non la riutilizza.
Su Debian installa i browser con
`pnpm exec playwright install --with-deps chromium webkit`.

Con `pnpm start` attivo in un altro terminale:

```sh
pnpm smoke
pnpm smoke --audio
pnpm smoke:browser
```

Smoke verifica endpoint, manifest, SW e grafiche. `--audio` verifica i tre MP3
pubblici con Range da 1 KiB senza salvarli. Gli E2E usano il vero elemento audio
con un WAV generato in memoria: nessuna dipendenza dai server esterni e nessuna
pretesa di aver verificato iPhone/CarPlay.

`smoke:browser` è un controllo opzionale con rete reale: riproduce i tre MP3 in
Chromium desktop, verifica playing/avanzamento e salva screenshot/JSON in `artifacts`.
Non fa parte della CI deterministica e non prova l’uscita audio fisica o iOS.

Comandi singoli: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:watch`.
`pnpm assets` rigenera le grafiche originali già incluse. La CI in
`.github/workflows/ci.yml` comprende anche build/runtime Docker; non è stata
avviata su GitHub. Esiti effettivi in [validation.md](validation.md).

## Docker locale

Serve Docker Engine avviato e Compose **2.24.4+** (motore Linux su Windows).

```sh
docker compose config --quiet
docker compose up --build -d --wait
```

Apri <http://localhost:8080>. Nginx serve la build e inoltra API/health a Fastify.
L’API non espone porte sull’host; il web è su `127.0.0.1:${WEB_PORT:-8080}`.

```sh
docker compose ps
docker compose logs --tail=100 api web
docker compose down
```

## Deploy Debian HTTPS

1. Installa Docker Engine e Compose dalla [guida Debian ufficiale](https://docs.docker.com/engine/install/debian/).
2. Copia il repository sul server; non servono `node_modules` o `dist` locali.
   Dalla radice esegui `cp .env.example .env`.
3. Imposta `MUSICBIT_DOMAIN` con un dominio reale **senza schema**, `ACME_EMAIL`
   con la tua email. Punta il DNS A al server; usa AAAA solo con IPv6 funzionante.
4. Rendi raggiungibili TCP 80 e 443 (UDP 443 facoltativo per HTTP/3). Non esporre
   3001 o 8080. Dalla radice:

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.https.yaml logs --tail=100 caddy
```

Caddy ottiene/rinnova TLS e inoltra a Nginx; l’override rimuove la porta HTTP
locale di Nginx. Apri `https://TUO_DOMINIO`, controlla `/health`, `/api/tracks` e
l’assenza di errori TLS. Mantieni i volumi `caddy_data` e `caddy_config` per
conservare i certificati. Per aggiornare copia le modifiche e ripeti `up --build
-d --wait`; per arrestare usa gli stessi due `-f` con `down`, senza `-v`.

M1 non include autenticazione: un dominio pubblico espone interfaccia e catalogo
demo. Per uso esclusivamente personale limita l’accesso alla tua rete/VPN con
HTTPS attendibile e DNS coerente.

## Installazione su iPhone

1. In Safari apri il dominio **HTTPS con certificato attendibile**. `localhost`
   sul telefono indica il telefono stesso, non il PC.
2. Attendi il catalogo e avvia una traccia con un tocco esplicito.
3. Condividi (o Altro → Condividi) → **Aggiungi alla schermata Home**.
4. Se disponibile lascia attivo **Apri come app web**, poi tocca **Aggiungi**.
5. Avvia dall’icona Home e verifica l’apertura senza barra Safari.
6. Esegui la [checklist](ios-checklist.md) in Safari e dalla Home e registra
   prove, versione iOS e JSON diagnostico nel [registro](ios-test-report.md).

I menu dipendono da iOS: [riferimento Apple](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios).
Incluse icone PNG 192, 512, maskable 512 e Apple touch 180 px.

## Playback e diagnostica

Il catalogo viene caricato all’avvio. `preload="none"` è il comportamento predefinito;
la preparazione esplicita abilita `auto` prima di Play. Il `preconnect` M1 resta
un suggerimento di connessione, senza garanzie su proxy/rete/iOS. `src`, `load()`
e `play()` vengono eseguiti nello stack sincrono del gesto, senza fetch/blob o
Web Audio. Le promise rifiutate e i comandi rapidi superati vengono gestiti.

La coda è in memoria, accetta duplicati e consente riordino/rimozione delle tracce
a seguire. `ended` avanza; l’ultima traccia ferma la coda. Precedente dopo 3 secondi
riparte da zero, altrimenti seleziona la precedente. Il seek usa la durata reale.
Media Session espone titolo, artista, album e cover e registra singolarmente le
azioni play/pause/previous/next/seek/stop accettate dal browser.

Diagnostica conserva gli ultimi 20 avvii e 100 eventi, includendo la visibilità
della pagina. Esporta JSON con user agent, secure context, standalone e timeOrigin.
I tempi usano `performance.now()`: comando, assegnazione sorgente, primo
`loadstart`, primo `loadeddata`, primo `playing`. `loadstart` è un indicatore di
caricamento, **non l’istante HTTP esatto**; `loadeddata` significa dati decodificati,
**non TTFB**. Resource Timing cross-origin può essere oscurato dalla sorgente.
Alla ripresa il buffer può evitare nuovi eventi: i valori mancanti restano “—”.
Il trigger distingue tocco, Media Session e fine traccia. `playing` non misura la
latenza fisica di speaker/Bluetooth.

Il SW conserva solo app shell e grafiche, non API o audio. Un aggiornamento
avvisa senza forzare reload durante l’ascolto: chiudi e riapri tutti i client
al termine della sessione. Offline + reload mostra UI e avviso catalogo assente.

## Sorgenti autorizzate

**SoundHelix Song 1, 2 e 3 — T. Schürger / SoundHelix**, MP3 HTTPS pubblici da
`www.soundhelix.com/examples/mp3/`. La [pagina originale](https://www.soundhelix.com/audio-examples)
consente l’uso con attribuzione a SoundHelix e all’artista. Non si attribuisce
qui una licenza CC: il permesso è quello esplicito del sito. Fonte, permesso e
attribuzioni sono inclusi nei contratti/API e nell’interfaccia.
Le copertine sono originali, riproducibili con `scripts/generate-assets.mjs`.
L’audio è riprodotto direttamente: nessuna copia, download offline, conversione o
ritrasmissione. Disponibilità e latenza dipendono dalla sorgente.

## Struttura ed estensione

```text
apps/web/src/player/engine.ts     audio persistente, stato, tempi e Media Session
apps/web/src/components/         diagnostica, icone e stato PWA
apps/web/src/components/Search.tsx ricerca e dettagli catalogo
apps/web/src/search-api.ts        client catalogo, timeout e validazione
apps/web/src/App.tsx              Player, Cerca, Coda e navigazione responsive
apps/web/src/catalog.ts           libreria demo, timeout e telemetria API
apps/api/src/app.ts               factory Fastify testabile senza porte
apps/api/src/providers/demo.ts    provider demo
apps/api/src/providers/youtube.ts provider metadati YouTube isolato
apps/api/src/catalog/             API, cache TTL e single-flight
packages/shared/src/index.ts     tipi, validazione runtime e MusicProvider
packages/shared/src/playback.ts  contratto PlaybackProvider indipendente
apps/api/src/playback/           resolver e factory Fastify del solo lab
experiments/playback/            UI/controller isolati, HTTP/HTTPS
tests/e2e/                       PWA/audio browser con fixture deterministica
scripts/benchmark.mjs            benchmark remoto con fasi HTTP e media
scripts/catalog-benchmark.mjs    benchmark live catalogo, p50/p95
scripts/https-test.mjs           HTTPS LAN con CA locale opzionale
experiments/hls/                 laboratorio live con toni originali
deploy/                         Nginx e Caddy
docs/                           architettura, checklist e registro verifiche
```

Un nuovo provider implementa `MusicProvider`, con capacità opzionale `catalog`;
`CatalogProvider` viene iniettato nel servizio metadati e `Track` resta il solo
contratto del player. Vedi [architettura](architecture.md). Shared è compilato
prima delle app; dopo modifiche ai contratti riavvia `pnpm dev` o esegui
`pnpm --filter @musicbit/shared build`.

## Limiti e lavori aperti

- Regressione M3/M4 su iPhone e CarPlay da eseguire. Le conferme iPhone M2 dell’utente
  non costituiscono misure di latenza né validazione di altre versioni/reti/dispositivi.
- CarPlay: nessuna app nativa, icona MusicBit o navigazione catalogo; si verifica
  l’eventuale integrazione “In riproduzione” offerta da iOS.
- Nessun catalogo/audio offline, ripristino coda, proxy musica, transcoding o HLS nel player,
  gapless, repeat o TTFB cross-origin garantito.
- Docker/deploy pubblico richiedono motore attivo, server e dominio validi.
- La CA locale richiede fiducia e raggiungibilità verificate sul telefono;
  Tailscale Serve non ancora abilitato. HLS ha solo evidenze server/PTS.
- Catalogo YouTube sperimentale: prima pagina, massimo 25 risultati per richiesta,
  fino a 100 brani per dettaglio album, senza ricerca paginata o audio YouTube.
  Nessun aggiramento di blocchi/login; termini del servizio da valutare prima del deploy.
- Branch locale dedicato; nessun contatto GitHub, push o PR. La sincronizzazione
  tramite GitHub Desktop è lasciata all’utente come richiesto.
