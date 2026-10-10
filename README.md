# MusicBit · Milestone 2

PWA musicale personale self-hosted, mobile-first, con React, Vite e Fastify.
Un solo `HTMLAudioElement` gestisce l’intera sessione passando tra Player, Coda
e Diagnostica. Nessun login, database, YouTube o download musicale persistente.
HLS è presente solo come laboratorio separato con toni originali.

**Stato:** M1 preservata, M2 performance/diagnostica implementata; background,
blocco schermo e CarPlay **non verificati
su iPhone fisico**. Gli E2E WebKit emulati non dimostrano il comportamento iOS.
Vedi [checklist](docs/ios-checklist.md) e [registro prove](docs/ios-test-report.md).

M2 mantiene il percorso nativo `src/load/play`, aggiunge preparazione **esplicita**
della traccia corrente, timeout/cancellazione e misure API, rete, buffer e lifecycle.
Apri `/?screen=diagnostics` per la diagnostica mobile con controlli ed export JSON.
Il comando **Prepara traccia** ricarica dall’inizio e può scaricare l’intero MP3:
il browser decide quanto precaricare e può ignorare il suggerimento su iOS.

La prima misura M1 ripetuta ha rilevato 7,60 s click→playing, di cui circa 7,27 s
nella fase proxy del browser. Con traccia preparata, tre campioni desktop M2
hanno dato **13,7–15,5 ms**, preceduti da **207,5–275,2 ms di preparazione**.
Rete/cache di sistema non controllate: questi risultati **non validano la soglia
0,5–1,5 s su iPhone**. Dati, fasi e limiti in [performance.md](docs/performance.md).

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
in [ios-https.md](docs/ios-https.md). Il PC deve restare acceso; la raggiungibilità
dal telefono va verificata sul telefono.

Su questo PC è stato verificato `https://192.168.1.69:4443` da desktop con controllo
CA/SAN e service worker. Tailscale è disponibile, ma Serve risulta disabilitato:
l’abilitazione amministrativa è ancora da completare. Non è stato usato un iPhone.

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
eventuale laboratorio sulla stessa porta. Analisi e limiti in [hls-feasibility.md](docs/hls-feasibility.md).

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
avviata su GitHub. Esiti effettivi in [validation.md](docs/validation.md).

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
6. Esegui la [checklist](docs/ios-checklist.md) in Safari e dalla Home e registra
   prove, versione iOS e JSON diagnostico nel [registro](docs/ios-test-report.md).

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
apps/web/src/App.tsx              Player, Coda e navigazione responsive
apps/web/src/catalog.ts           richiesta catalogo, timeout e telemetria API
apps/api/src/app.ts               factory Fastify testabile senza porte
apps/api/src/providers/demo.ts    provider demo
packages/shared/src/index.ts     tipi, validazione runtime e MusicProvider
tests/e2e/                       PWA/audio browser con fixture deterministica
scripts/benchmark.mjs            benchmark remoto con fasi HTTP e media
scripts/https-test.mjs           HTTPS LAN con CA locale opzionale
experiments/hls/                 laboratorio live con toni originali
deploy/                         Nginx e Caddy
docs/                           architettura, checklist e registro verifiche
```

Un nuovo provider implementa `MusicProvider` e viene passato a `buildApp` senza
cambiare il player; vedi [architettura](docs/architecture.md). Shared è compilato
prima delle app; dopo modifiche ai contratti riavvia `pnpm dev` o esegui
`pnpm --filter @musicbit/shared build`.

## Limiti e lavori aperti

- Prove iPhone fisico e CarPlay obbligatorie e ancora da eseguire: nessuna garanzia
  di background o cambio traccia quando la pagina è sospesa.
- CarPlay: nessuna app nativa, icona MusicBit o navigazione catalogo; si verifica
  l’eventuale integrazione “In riproduzione” offerta da iOS.
- Nessun catalogo/audio offline, ripristino coda, proxy musica, transcoding o HLS nel player,
  gapless, repeat o TTFB cross-origin garantito.
- Docker/deploy pubblico richiedono motore attivo, server e dominio validi.
- La CA locale richiede fiducia e raggiungibilità verificate sul telefono;
  Tailscale Serve non ancora abilitato. HLS ha solo evidenze server/PTS.
- YouTube.js resta una valutazione futura per metadati/ricerca, senza integrazione M2.
- Branch locale dedicato; nessun contatto GitHub, push o PR. La sincronizzazione
  tramite GitHub Desktop è lasciata all’utente come richiesto.
