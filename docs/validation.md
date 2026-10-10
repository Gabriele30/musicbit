# Verifiche locali M2 e storico M1

## M2 — 10 ottobre 2026

Branch locale `codex/m2-performance-ios`, partenza da M1 `b8bd2a3` senza modifiche
preesistenti. Nessun contatto GitHub, push o PR. Node 24.14.0, pnpm 11.25.0,
Windows/PowerShell.

- `pnpm install --frozen-lockfile`: lockfile valido; aggiunta solo node-forge
  1.4.0 come devDependency per CA di test, non nelle app runtime.
- `pnpm check`: lint senza warning, typecheck, **45/45 Vitest**, build production.
- `pnpm test:e2e`: **12/12** Chromium/WebKit mobile emulati. Preservati gli otto
  M1; aggiunti preparazione senza autoplay/riuso audio/export, deep link diagnostica
  e cambio rapido fino all’ultima traccia. Fixture native locali, nessun server remoto.
- `pnpm smoke --audio`: API/app shell/manifest/SW/grafiche, tre MP3 con Range 206.
- `pnpm smoke:browser`: tutti e tre gli MP3 reali playing e posizione crescente,
  durate 372,7 / 426,0 / 344,1 s, nessun errore. Volume zero, speaker non verificati.
- Benchmark prima/dopo e controllo proxy: [performance.md](performance.md), JSON
  versionabili in `docs/performance/`. Tempi al playing, non al suono fisico.
- `pnpm smoke:https`, con MUSICBIT_HTTPS_URL all’IP LAN 192.168.1.69:4443:
  CA/SAN/TLS, health, tracks, manifest, SW e schermata mobile; contesto sicuro e
  client controllato da SW. Pin SPKI del solo certificato nel processo Chromium,
  nessuna installazione di fiducia di sistema. [Evidenza](performance/https-smoke.json).
- `pnpm smoke:hls`: playlist live rolling sequence 0→1 con sei segmenti,
  decodifica di due segmenti e 188 pacchetti AAC, continuità PTS entro ~1 μs.
  [Evidenza](performance/hls-smoke.json). Non è una prova nativa iOS.

Screenshot e JSON delle tre tracce in `artifacts/`, report in `playwright-report/`.
Certificati/chiavi privati e media sintetici del laboratorio sono esclusi da Git.
I report diagnostici possono contenere UA, URL, orari e contesto del dispositivo:
rivederli prima di condividerli.

Limiti: nessuna prova fisica iPhone, lock screen, background o CarPlay; fiducia
CA/firewall/accesso dal telefono da verificare. Tailscale Serve disabilitato nella
tailnet (nessuna configurazione esistente modificata). Docker/runtime Debian e
CI remota non rieseguiti in M2. HLS principale, anticipazione della successiva,
metadati/comandi HLS e prestazioni/consumi server restano da validare.

## Storico M1

Ambiente: Windows/PowerShell, Node 24.14.0, pnpm 11.25.0.
Branch `codex/m1-foundation`, nessun contatto GitHub, push o PR.
Data della verifica: **10 ottobre 2026**, fuso Europe/Rome.

## Controlli superati

- `pnpm install` e `pnpm install --frozen-lockfile`: installazione/lockfile validi.
- `pnpm lint`: zero errori e zero warning ESLint.
- `pnpm typecheck`: pacchetti shared, API e web validi in modalità strict.
- `pnpm test`: **35/35** test Vitest dei contratti, API, engine audio e componenti React.
- `pnpm build`: tutti i pacchetti compilati, manifest e SW production generati.
- `pnpm test:e2e`: **8/8** E2E su Chromium mobile e WebKit mobile emulati:
  controllo audio, navigazione senza ricreazione dell’elemento, seek, coda,
  evento ended reale, errori HTTP media/recupero e app shell offline senza media.
- `pnpm smoke --audio`: health, catalogo, app shell, manifest, SW, icone e cover
  HTTP 200; tre MP3 pubblici con risposta Range 206.
- `pnpm smoke:browser`: tre MP3 reali in Chromium desktop 156.0.8078.4,
  evento playing e posizione in avanzamento, readyState 4, nessun errore audio.
  Durate rilevate: 372,7 s, 426,0 s, 344,1 s. Il volume browser è stato azzerato:
  questa prova non verifica speaker fisici.
- `pnpm format:check` e `git diff --check`: stile e whitespace verificati.
- Entrambe le configurazioni `docker compose config --quiet`, locale e HTTPS.

Le evidenze locali sono in `artifacts/` (ignorata da Git): screenshot desktop e
mobile, `real-audio-results.json`, `real-audio-diagnostics.json`. Il report E2E
è in `playwright-report/`; può essere aperto con `pnpm exec playwright show-report`.

## Latenza osservata sulle sorgenti reali

Una sola sequenza, senza valore statistico: click → playing **7615,1 ms** sulla
prima traccia, **64,1 ms** sulla seconda, **384,0 ms** sulla terza. Il primo avvio
remoto è quindi sensibilmente lento. Non si dichiara raggiunto un obiettivo di
latenza su iPhone o in generale: servono più campioni, una soglia concordata e
prove sul dispositivo/rete di destinazione. La diagnostica conserva i dati reali.

## Avvio su Windows

`pnpm start` avvia correttamente API e preview. La porta standard Vite 5173 è
esclusa da Windows nell’intervallo 5141–5240 su questa macchina. Lo sviluppo usa
4175, libera e configurabile con `WEB_DEV_PORT`, senza modificare riserve di sistema.
`pnpm dev` verificato in esecuzione su 4175: interfaccia, `/health` e `/api/tracks`
rispondono HTTP 200 tramite il proxy Vite.

Il 10 ottobre 2026 i tre MP3 hanno risposto a Range bytes=0-1023 con **206**,
Content-Type audio/mpeg e Accept-Ranges bytes. La pagina di SoundHelix include
il permesso esplicito con attribuzione, pur rispondendo attualmente HTTP 500;
i file audio rispondono regolarmente.

Docker CLI 29.2.0 / Compose 5.0.2 presenti. Avviato Docker Desktop, il backend
fallisce con `starting services: initializing Inference manager` e un errore di
accesso al socket locale `dockerInference`. `docker compose build` è stato
tentato e terminato dopo 25 secondi senza engine disponibile. Nessun reset,
modifica alle impostazioni Docker o eliminazione di dati eseguita.
Build/runtime container **non verificati**, nonostante le configurazioni valide.
HTTPS reale richiede inoltre server/dominio/certificato attendibile. CI remota non avviata.
Nessuna prova fisica iPhone o CarPlay: vedi `ios-test-report.md`.
