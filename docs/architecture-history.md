# Architettura M1 + M2 + M3

## Aggiornamento — 11 ottobre 2026

Il player principale ora usa anche `GET/HEAD /api/audio/:id` tramite
`AudioStreamService` e proxy con Range. L’elemento audio rimane unico, costruito
in `main.tsx`. `player/session.ts` ripristina coda/posizione/ripetizione in pausa;
`library.ts` conserva i preferiti locali. Nessun file audio viene salvato nello
storage della PWA. [Audit corrente e limiti](product-audit.md).
Il resto del documento conserva l’evoluzione storica M1–M5.

```text
Safari / PWA → stessa origine /api/tracks → Fastify → MusicProvider
          └→ HTMLAudioElement → sorgente MP3 HTTPS autorizzata
          └→ Media Session → controlli offerti dal sistema operativo
          └→ /api/search, /api/catalog, /api/providers
                 → CatalogService → TTL/LRU + single-flight → CatalogProvider
                     → YouTubeCatalogProvider → youtubei.js → search/browse/next
```

Vite fa da proxy in dev/preview, Nginx nei container; Caddy aggiunge TLS.
Il media viene riprodotto direttamente, senza Web Audio o crossOrigin anonymous:
nessun CORS richiesto per il semplice elemento audio.

`main.tsx` crea e appende un solo audio prima di montare React. `PlayerEngine`
conserva elemento, listener, coda e diagnostica; `useSyncExternalStore` legge
snapshot immutabili. Navigare non smonta audio. Teardown riservato a test e HMR.
Play/next/previous chiamano subito `play()` senza await; un contatore invalida le
promise precedenti dopo nuovi comandi/pausa/errori. Il passaggio automatico usa
`ended`, senza timer JS: l’esecuzione a pagina sospesa va provata su iPhone.

Stati: idle, loading, playing, paused, ended, error. `waiting` indica buffering;
`stalled` si registra perché può risolversi. Un errore non salta automaticamente
le tracce; si può riprovare o cambiare sorgente. Nessun autoplay al caricamento.

M2 estende l’engine esistente: preparazione opt-in dell’attuale src nello stesso
audio, stato separato della preparazione e consumo senza nuovo load; annullamento
e timeout rilasciano la sorgente nativa. Deadline 15 s, ripulita per ogni nuovo
comando, sospesa/deferita a pagina hidden; non arresta audio nativo avanzato
quando gli eventi JS tardano. Nessun secondo audio per precaricare la successiva.
Pausa mantiene il buffer per conservare il comportamento M1.

`catalog.ts` isola timeout API 10 s e cancellazione con AbortController, registra
header/corpo/validazione. `Server-Timing` misura solo il provider Fastify.
Gli URL del provider demo sono diretti: nessuna seconda risoluzione stream.
Resource Timing opzionale rispetta TAO; diagnostica espone intervalli buffered,
waiting, errori, lifecycle con traccia/posizione e osservazione umana del suono.
Log limitati, niente keepalive/polling in background. `/?screen=diagnostics`
apre direttamente la vista mobile senza ricreare audio.

Shared definisce Track, risposte, validazione runtime e MusicProvider con id,
listTracks/getTrack. Le sorgenti richiedono HTTPS oppure un percorso relativo
alla stessa origine; artista, fonte, permesso e attribuzione sono obbligatori.
Il provider demo restituisce copie dei dati. La factory Fastify accetta provider
iniettati; testata anche sostituzione e fallimento.

Vite PWA genera manifest e SW Workbox per il solo app shell/grafiche; niente cache
runtime di API/media né handler Range. API/health e laboratorio /\_\_hls esclusi dal fallback HTML.
Gli aggiornamenti attendono la chiusura dei client; SW disattivato in dev.

`scripts/https-test.mjs` aggiunge TLS solo all’ambiente di test con CA locale
non installata automaticamente; /\_\_hls inoltra il laboratorio separato a 4180.
Il laboratorio usa un encoder live di toni originali, non MusicProvider né URL
MP3 remoti. Non modifica build Docker o dipendenze runtime delle app.

M3 aggiunge `MusicProvider.catalog?: CatalogProvider`. `CatalogItem` rappresenta
metadati senza `audioUrl`, sempre `playback.available=false`; non è un `Track` e
non viene mai passato all’engine. Il provider YouTube non restituisce tracce
riproducibili. Sessione anonima locale e lazy, niente player JS/config di streaming;
fetch limitato ai soli endpoint search/browse/next, redirect rifiutati.

La ricerca monta una schermata React separata; il debounce e le richieste hanno
AbortController e pulizia all’unmount. Il client evita `AbortSignal.any` per
compatibilità con versioni Safari che non lo supportano. L’audio e la sua Media Session continuano
a descrivere la demo anche mentre si guardano altri metadati. API, caching,
cancellazione per subscriber e limiti sono descritti in [catalog.md](catalog.md).

Rimandati login, persistenza, libreria privata, raccomandazioni, HLS nel
player e audio YouTube. Prima di evolvere il trasporto servono prove fisiche: WebKit su Windows
non replica processi, sospensione, Bluetooth o CarPlay di iOS.

## Laboratorio M4

`PlaybackProvider` è separato da `CatalogProvider`: identità di catalogo →
descrittore autorizzato con formato, trasporto, validità e disponibilità/errori.
`apps/api/src/playback` contiene provider demo, cache TTL vincolata alla scadenza,
single-flight e factory Fastify **non registrata** nell'API principale.
`experiments/playback` è un workspace con UI/controller nativo e un solo audio,
su origine/porta distinta; la build è inclusa nei controlli del monorepo.

Nessuna modifica al player principale: il confronto non dimostra un beneficio.
Staging della prossima significa risolvere il descrittore senza richiederne
l'audio, preservando il brano corrente. Preparazione byte soltanto esplicita,
a player fermo. Manifest separato, nessun SW o cache media. API, misure,
conformità e proposta di integrazione futura nel
[report M4](playback-feasibility.md).

# Estensione M5 isolata

Il catalogo principale resta metadata-only. `YouTubePlaybackProvider` riusa
il contratto indipendente `PlaybackProvider`, risoluzione/cache M4 e controller
nativo M4 solo nel processo `experiments/youtube-playback/server.mjs`.
Endpoint `/__youtube/health`, `GET /__youtube/api/search`,
`POST /__youtube/api/resolve`; quest'ultimo accetta esclusivamente provider
`youtube` e video ID di 11 caratteri, mai URL o credenziali del browser.
Default disabilitato e lista di permessi vuota. Contratto diagnostico condiviso
in `packages/shared/src/youtube-playback.ts` senza URL firmati.
L'iframe ufficiale visibile è un controllo foreground distinto dal motore nativo;
non entra nel resolver e si ferma quando la pagina è nascosta.
[Architettura, limiti e misure M5](youtube-playback-feasibility.md).

## Home, libreria e autoplay — 11 ottobre 2026

- `GET /api/feed`: sezioni del feed del provider, con riferimenti navigabili ad
  artisti e album. Cache TTL, cancellazione e limiti condividono CatalogService.
- `GET /api/recommendations/:id`: radio del brano, escluso il seed, ID validato.
- I dettagli artista includono `tracks`, `albums`, `relatedArtists`; i brani
  possono avere `artistId` e `albumId`. Contratti in `packages/shared` e
  validazione del client prima dell’uso.
- `connectAutoplay` vive fuori da React con il motore e prepara solo metadati
  dei suggerimenti. Alla fine della coda il motore usa una sorgente relativa già
  disponibile, senza attese prima di `audio.play()`. Coda manuale/repeat prevalgono;
  risultati vecchi e duplicati sono esclusi. Nessun autoplay al ripristino.
- La libreria locale versionata conserva preferiti, playlist, cronologia,
  album salvati e artisti seguiti; migra i preferiti già esistenti. Errori/quota
  di localStorage non bloccano il player. Nessuna sincronizzazione o cache audio.
- L’init AAC-LC frammentato è ispezionato una volta per descrittore (massimo
  64 KiB). Per un singolo edit di priming breve con durata non zero, il proxy
  normalizza `segment_duration=0`, preservando media_time, campioni e offset.
  La stessa patch di quattro byte si applica a ogni Range che la interseca.
  Gli ETag del file originale non sono riutilizzati sul payload modificato.
  [Motivazione, verifiche e limiti](product-audit.md).

## Shell del prodotto e stato di navigazione

Le destinazioni principali sono Home, Cerca e Libreria. Player, coda e diagnostica
restano raggiungibili via URL `screen`, con apertura dal mini-player, dalla barra
del player e dalle impostazioni. La chiusura delle viste secondarie usa la storia
di navigazione quando disponibile, con fallback alla sezione principale.

Home, ricerca e libreria restano montate e sono nascoste tramite `hidden`.
L'App conserva il tab della libreria e le posizioni di scroll, gestendo
`history.scrollRestoration` esplicitamente. I dettagli della ricerca conservano
anche lo scroll dei risultati e delle pagine precedenti. I dettagli non hanno
ancora URL propri. `ActionMenu` usa un dialog nativo e ripristina il focus
dell'apertura per WebKit. `CoverArt` condivide caricamento e fallback delle immagini.

Il catalogo demo è richiesto solo da diagnostica o da `demo=1`; non interviene
nel feed o nell'apertura ordinaria di un player vuoto. Il singolo audio e i suoi
collegamenti alla persistenza e all'autoplay restano esterni a React.
