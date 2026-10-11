# Validation and historical test reports

## Esperienza personale, ascolto e AI playlist — 11 ottobre 2026

- `pnpm check`: lint, typecheck, **230 test unitari** in 32 file e build di produzione riusciti.
- `pnpm test:e2e`: **70/70** test Chromium/WebKit con viewport mobile riusciti. Il run usa le porte 4707–4709 perché Windows riserva alcune porte predefinite.
- La copertura verifica suggerimenti istantanei, coda e radio persistenti, shuffle uniforme, ripresa da un secondo dispositivo solo dopo un tap, cronologia, statistiche Wrapped, Taste Profile modificabile, mix automatici e salvataggio esplicito della preview AI.
- Le statistiche registrano tempo di ascolto effettivo, con deduplicazione degli eventi offline; la cancellazione delle statistiche impedisce la reiniezione di eventi precedenti alla cancellazione.
- Il server conserva la chiave AI esclusivamente nell’ambiente (`OPENAI_API_KEY`). Senza chiave la pagina spiega la configurazione e non invia richieste a servizi esterni. La suite usa un servizio AI controllato e non espone credenziali nel browser.
- Entrambi i file Compose sono validi con `docker compose config --quiet`. Le prove fisiche iPhone, lock screen, Bluetooth e CarPlay restano necessarie prima della distribuzione pubblica.
## Accounts, profiles and personal libraries — 11 October 2026

- `pnpm check`: lint, type checks, **212 unit tests** across 26 files and production builds passed.
- `pnpm test:e2e --workers=4`: **64/64** Chromium/WebKit mobile tests passed. Account coverage includes registration, profile edits, backup import/export, second-browser synchronization, persistent conflict recovery and logout, retaining one audio element.
- Browser tests use a separate API on configurable port 4703 and an in-memory account database. They no longer create test accounts in the running personal instance.
- Unit coverage includes separate libraries, rejected stale revisions, cross-tab account binding, password/session rotation, database restarts, offline conflicts, provider cancellation/deadlines and native permission probes. SQLite, native process bindings, child processes and account-file reads are blocked in the provider process.
- Real AAC playback and seek passed in both desktop browsers after provider separation. Latest single-sample cold/cache-warm timings were 4721/353 ms during browser-test load; these are not browser comparisons, physical sound measurements, p95 statistics or an achieved startup target. [Live report](performance/account-audio.json).
- Local account login/reload was verified over LAN HTTPS in desktop WebKit with isolated certificate-error handling, no JavaScript errors and one audio element. This does not establish iPhone certificate trust or hardware playback behavior.
- Both Docker Compose configurations validate. The local Docker daemon is unavailable, so this change has no local container build/runtime result. No remote CI run was requested.
- Physical iPhone long sessions, lock-screen controls, interruptions and measured cold-start optimization remain pending. Advanced OS/container isolation, shareable detail URLs, search pagination and automatic conflict merging remain roadmap work.

## Search, playlists and repository preparation — 11 October 2026

- `pnpm check`: lint, type checks, **193 unit tests** across 19 files and all production builds passed.
- `pnpm test:e2e --workers=4`: **62/62** tests passed in Chromium and WebKit with mobile viewports. Coverage includes mixed search results during a category failure, recent-query persistence/deletion, playlist menus, reordering, rename, undo and playback from an intermediate track without losing earlier queue entries.
- The optional live-provider smoke passed in both browsers: feed, artist details, AAC playback, recommendations and navigation retained the same audio element, with no page errors. [Live report](performance/search-playlist-live.json).
- `pnpm install --frozen-lockfile` and both Docker Compose configuration checks passed. The local Docker daemon was unavailable, so container build/runtime verification is delegated to the repository CI.
- README screenshots are from the running application. [Desktop](assets/desktop.png), [Home](assets/home.png), [Artist](assets/artist.png), [Player](assets/player.png).
- Physical iPhone, screen lock, Bluetooth and CarPlay tests remain pending. Search pagination, shareable detail URLs and library backup/sync remain roadmap work.

Historical LAN addresses in the reports below have been replaced with a documentation placeholder. Earlier statements about no GitHub activity describe the corresponding local milestone, before repository publication was requested.

## Audit prodotto — 11 ottobre 2026

Il player principale ora integra playback YouTube Music e proxy audio; le sezioni
M1–M5 seguenti sono storiche. [Audit, correzioni e criticità aperte](product-audit.md).

- `pnpm check`: lint, typecheck, **187 test** e build riusciti.
- `pnpm test:e2e --workers=4`: **60/60** Chromium/WebKit mobile riusciti, con porte
  `MUSICBIT_E2E_PORT=4704`, `MUSICBIT_PLAYBACK_E2E_PORT=4706`, `MUSICBIT_YOUTUBE_E2E_PORT=4708`
  perché Windows riserva le porte predefinite. Nessuna modifica alle riserve del sistema.
- `pnpm smoke:audio`: riproduzione reale via proxy e seek a 10 s in Chromium e
  WebKit desktop, Range 206. [Report](performance/audit-live-audio.json).
- Un solo audio, sessione ripristinata in pausa, ricerca preservata, preferiti
  persistenti e libreria filtrabile verificati. Browser desktop/emulati non
  sostituiscono le prove fisiche iPhone/lock screen/CarPlay.
- Nuovo percorso: Home/feed reale, pagine artista con brani e discografia, album
  salvati/artisti seguiti, playlist create/riordinate/rinominate/eliminate e
  persistenti, autoplay con fine nativa del brano e cronologia verificati nei due browser.
- Regressione durata: un flusso proxy con durata nativa 360 s e catalogo 180 s
  mostra 180 s, conserva la fine completa e avanza dopo 181 s; in assenza di
  tracce successive arresta anche l’elemento audio. Durate native normali e
  metadati esterni imprecisi non sono troncati.
- Prova completa con catalogo reale: Daft Punk, 25 brani popolari, 20 album e
  10 artisti simili; Home, suggerimenti, cronologia e singolo audio funzionanti
  in Chromium/WebKit. Zero errori JavaScript. [Report](performance/music-experience-live.json).
- Il test live ha rilevato e corretto un caso AAC con edit di priming che faceva
  terminare WebKit Windows senza `playing`. Il probe ora rifiuta quel falso positivo.
  Dopo la correzione, avvio e seek reali di `khnokW3Mw24` passano nei due browser
  (2297 ms Chromium cold, 453 ms WebKit warm: singoli campioni, non benchmark).
  [Report AAC](performance/aac-edit-live.json). Nessuna modifica ai campioni audio;
  edit, lunghezza e Range verificati da test dedicati.
- Modifiche preesistenti preservate. Nessun contatto GitHub, push, PR o commit.

### Redesign iniziale — 11 ottobre 2026

- Home con musica nella prima schermata, tre destinazioni principali, player
  a schermo intero mobile, coda dal player, mini-player inferiore desktop.
- Libreria e ricerca conservate tra sezioni; scroll ripristinato dopo player/coda.
  Menu con Escape, focus ripristinato esplicitamente in WebKit e passaggio al
  selettore playlist verificati. Demo escluse dalle sessioni normali.
- Sei nuovi E2E, inclusi layout a 320 px e desktop a 1440 px, mantenimento di
  filtri/scroll/audio e player vuoto senza caricamento automatico delle demo.
- `pnpm check`: 187 test unitari, lint, tipi e build. Suite completa: 60 E2E.
- Prova live separata nei due browser: feed reale, artista Daft Punk con 25
  brani e 20 album, playback AAC e suggerimenti; nessun errore JavaScript e
  stesso elemento audio. Prima card a circa 246 CSS px dall'alto su viewport
  mobile; zero richieste al catalogo demo durante il percorso normale.
  [Report](performance/redesign-live.json).
- Screenshot reali Home/artista/player/desktop in `artifacts/*-live-*.png`,
  screenshot con dati controllati in `artifacts/*-redesign-*.png`.
  Si tratta di browser desktop/emulati; prove fisiche iPhone e ricerca di
  usabilità con utenti restano aperte.

## M5 — 10 ottobre 2026

Branch `codex/m5-youtube-playback`. Modifiche M4 precedenti preservate nella
working tree; nessun contatto GitHub, push/PR o CI remota. Main player,
`apps/web`, API principale e guard del catalogo YouTube M3 invariati.

- `pnpm install` e `pnpm install --frozen-lockfile`: riusciti; nuovo workspace
  `experiments/youtube-playback`, nessuna nuova libreria runtime o modifica alla
  versione `youtubei.js@18.1.0`.
- `pnpm check`: lint senza errori/warning, typecheck strict, **141/141 Vitest**
  e build shared/API/web/lab M4/lab M5. Conservati tutti i 108 M1–M4, aggiunti
  33; incluso risultato tardivo annullato che non può sovrascrivere la diagnostica nuova.
- `pnpm test:e2e`: **40/40**, Chromium e WebKit mobile emulati. Conservati tutti
  i 30 M1–M4, aggiunti 10: sorgente indisponibile, ricerca/selezione/risoluzione,
  preparazione/play/next senza ricreare audio, layout/manifest/isolamento,
  HTTP media 403 con errore visibile e nessun fallback. Audio PCM originale
  locale e provider iniettato esclusivamente nel server E2E, non stream YouTube.
- Il nuovo test HTTP inizialmente assumeva che WebKit Windows esponesse le
  richieste native in `page.on('request')`. Corretto osservando il 403 dal server
  HTTP di test con contatori separati per browser; non è stato rimosso il controllo.
- `pnpm benchmark:youtube`, due esecuzioni live con controllo iframe esplicito:
  catalogo reale cold/warm, sorgente diretta disabilitata senza permessi;
  prima prova iframe errore di inizializzazione `2`, corretta passando il video
  ID al costruttore; seconda prova foreground playing. Dati separati
  [iniziali](performance/m5-initial-live.json) e [finali](performance/m5-live.json).
- `pnpm smoke:youtube:https`: CA/SAN validati da Node su **192.168.1.100:4463**,
  pagina/manifest/icona, layout mobile, un audio, nessun SW/iframe automatico,
  Play non disponibile senza sorgente autorizzata. [Evidenza](performance/m5-https-smoke.json).
  Chromium usa un pin del certificato solo nel processo; trust iPhone non dimostrato.
- Formattazione Prettier e whitespace Git verificati; nessun errore rimasto.

**Criterio native YouTube non raggiunto:** zero richieste `/player` dal provider
M5 verso il servizio reale, zero formati/URL media reali osservati. Mancano
permessi documentati per accesso diretto; metriche di stream/preparazione/play
nativi restano null. I 403/429 del provider sono testati con mock, non dichiarati
come blocchi reali. Iframe ufficiale è un controllo separato, non un successo
del `PlaybackProvider`. Nessuna prova fisica M5 iPhone, lockscreen, next o CarPlay.
Docker build/runtime non rieseguiti in M5; resta il limite del motore locale M4.
[Report tecnico](youtube-playback-feasibility.md),
[procedura e permessi](youtube-playback-ios-checklist.md).

## M4 — 10 ottobre 2026

Branch `codex/m4-playback-engine`, partenza da M3 `d180cf9`, working tree
inizialmente pulito. Windows/PowerShell, Node 24.14.0, pnpm 11.25.0.
Nessun contatto GitHub, push o PR. Nuovo workspace del laboratorio; nessuna
nuova libreria runtime e nessun aggiornamento di YouTube.js.

- `pnpm install` e `pnpm install --frozen-lockfile`: riusciti, lockfile aggiornato
  con il workspace `experiments/playback`.
- `pnpm check`: lint zero errori/warning, typecheck, **108/108 Vitest**, build di
  shared/API/web/lab. Conservati gli 83 test M3, aggiunti 25.
- `pnpm test:e2e`: **30/30**, Chromium/WebKit mobile emulati. Conservati i 20 M3,
  aggiunti 10: ricerca/risoluzione, preparazione senza autoplay, un solo audio,
  cache calda, selezione durante playback, YouTube indisponibile, cambio nativo
  e HTTP media 404 con recupero. Fixture PCM originali locali; SW principale testato.
- `pnpm format:check` e `git diff --check`: riusciti dopo correzione formattazione.
- `pnpm smoke --audio`: principali health/tracks/app shell/manifest/SW/grafiche;
  tutti e tre i MP3 autorizzati rispondono Range 206.
- Due `pnpm benchmark:playback`: 25 avvii e 5 cambi riusciti per sessione,
  cache descrittore fredda/calda, preparazione e fasi HTTP. La seconda sessione
  ruota l'ordine dei cinque scenari. Dati in
  [report M4](playback-feasibility.md), senza inferenze di latenza fisica iOS.
- `pnpm smoke:catalog`, output separato M4: servizio reale, ricerca/dettagli e
  continuità demo. Run HTTP loopback, `tlsVerified=false`; la descrizione generica
  delle eccezioni TLS nello script non significa una verifica TLS in quel run.
  [Evidenza](performance/m4-main-catalog-regression.json).
- `pnpm smoke:playback:https` all'IP **192.168.1.100:4453**: Node verifica CA/SAN,
  health/HTML/manifest/icona; browser verifica layout mobile, sorgente remota
  autorizzata, preparazione/play e un audio, nessun SW del lab. Pin SPKI limitato
  al processo browser, nessun trust installato. [Evidenza](performance/m4-https-smoke.json).
- Entrambe le configurazioni `docker compose config --quiet`: valide.
  La richiesta della versione server Docker non ha risposto ed è stata annullata;
  build/runtime container non verificati. Nessun avvio/reset o modifica Docker.

`git diff -- apps/web/src apps/api/src/providers/youtube.ts apps/api/src/app.ts`
vuoto: player/UI principali e provider M3 invariati. Bundle principale conserva
lo stesso hash JS osservato all'avvio delle verifiche M4.
Lab HTTPS lasciato disponibile per la prova manuale; screenshot in
`artifacts/playback-lab-m4.png`, report E2E in `playwright-report/` (ignorati).

Nessuna prova fisica M4, di primo suono, lock screen o CarPlay. Manifest lab
separato senza offline, nessun audio YouTube estratto/provato. HLS M2 conservato,
non rieseguito né promosso nel principale. HTTPS pubblico/CI remota non verificati.
[Procedura](playback-ios-checklist.md), [registro](ios-test-report.md).

## M3 — 10 ottobre 2026

Branch locale `codex/m3-music-catalog`, da M2, working tree inizialmente pulito.
Node 24.14.0, pnpm 11.25.0, Windows/PowerShell. Nessun contatto GitHub, push o PR.
Dipendenza runtime aggiunta: `youtubei.js@18.1.0`, lockfile aggiornato.

- `pnpm install --frozen-lockfile`: installazione e lockfile validi.

- `pnpm check`: ESLint senza warning, typecheck strict, **83/83 Vitest**, build
  shared/API/web production, manifest e SW generati. Engine M2 invariato.
- `pnpm test:e2e`: **20/20** Chromium/WebKit mobile emulati: preservati i dodici
  M2, aggiunti debounce, navigazione e dettagli brani/artisti/album, tracklist,
  errori/vuoti/riprova, risposta superata e audio nativo demo persistente durante
  la ricerca. Mock deterministici del catalogo, senza servizio YouTube nella CI.
- Test backend aggiunti: normalizzazione, guardia degli endpoint metadati,
  cache TTL/LRU/dedup, abort subscriber indipendenti, timeout, overload, validazione
  HTTP, errori sicuri e redazione dei log. Disconnessione HTTP verificata anche
  con socket locale reale; mock provider deterministici.
- Test frontend aggiunti: contratti runtime, metadati separati dall’audio,
  dettagli incoerenti rifiutati, timeout, cancellazione e corpo JSON tardivo.
- Servizio reale: ricerche e dettagli dei tre tipi riusciti; benchmark esplicito
  **15 cold + 15 warm**, più tre dettagli, senza errori, con p50/p95 e report
  [catalog-m3.json](performance/catalog-m3.json). Vedi [metodo e limiti](catalog-performance.md).
- `pnpm smoke --audio`: health, demo, manifest, SW, grafiche e tre MP3 Range 206.
- `pnpm smoke:catalog` sulla LAN HTTPS: CA/SAN, M3, ricerca/dettagli reali,
  un solo audio SoundHelix in avanzamento, nessun Play YouTube, layout mobile;
  [report desktop](performance/catalog-live-smoke.json). Nessuna prova hardware.
- `pnpm format:check`, `git diff --check`: stile e whitespace verificati.
- Entrambe le configurazioni `docker compose config --quiet`: valide, incluse
  variabili del catalogo e override HTTPS con dominio/email di esempio. Nessuna
  esecuzione container o validazione runtime Nginx dichiarata.

I primi E2E catalogo WebKit fallivano perché il service worker intercettava
richieste prima dei mock Playwright. La suite catalogo ora disabilita SW soltanto
nei suoi test; la suite player conserva il vero test production di PWA/offline.
Non è stata modificata la strategia cache del SW dell’applicazione.

Screenshot catalogo in `artifacts/*-catalog-m3.png`; report E2E in
`playwright-report/`. I risultati fisici M2 sono riferiti dall’utente e riportati
nel [registro](ios-test-report.md). Nessuna nuova prova fisica M3 né CarPlay.
Runtime Docker/HTTPS pubblico/CI remota non verificati in questa milestone.
Limitazioni funzionali e conformità in [catalog.md](catalog.md) e
[catalog-compliance.md](catalog-compliance.md).

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
- `pnpm smoke:https`, con MUSICBIT_HTTPS_URL all’IP LAN 192.168.1.100:4443:
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
