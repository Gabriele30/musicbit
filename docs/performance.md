# M2: prestazioni misurate

Le misure del nuovo catalogo M3, cache fredda/calda e p50/p95 sono documentate
separatamente in [catalog-performance.md](catalog-performance.md). Questo storico
resta riferito all’audio M2; le conferme fisiche dell’utente sono nel
[registro iOS](ios-test-report.md), senza nuovi tempi al suono.

10 ottobre 2026, Windows, Node 24.14.0, pnpm 11.25.0, Chromium 156.0.8078.4.
Baseline: commit M1 `b8bd2a3`, prima di modificare il player. Branch M2:
`codex/m2-performance-ios`. I campioni usano SoundHelix Song 1 autorizzata,
volume zero, nessun file musicale salvato. Non è una prova di suono fisico.

## Risultati e confronto

| Scenario                                              | Click → playing, ms (ordine dei campioni) | Preparazione prima del click, ms |
| ----------------------------------------------------- | ----------------------------------------- | -------------------------------- |
| M1 prima delle modifiche                              | 7600,9 / 241,2 / 240,6                    | Nessuna                          |
| M2 controllo iniziale senza preparazione              | 7653,7 / 216,6 / 200,0                    | Nessuna                          |
| M2 misura finale senza preparazione, proxy già rapido | 331,6 / 234,9 / 234,3                     | Nessuna                          |
| M2 misura finale con preparazione esplicita           | 15,5 / 15,3 / 13,7                        | 275,2 / 215,6 / 207,5            |
| M2 controllo browser con `--no-proxy-server`          | 437,5 / 257,5 / 237,5                     | Nessuna                          |

Report grezzi in [performance/](performance/): `m2-before.json`,
`m2-cold-confirmation.json`, `m2-after-unprepared.json`, `m2-after-prepared.json`,
`m2-direct-control.json`. Il controllo iniziale M2 conserva un riepilogo dai log
della prima esecuzione, precedente alla separazione delle fasi nel benchmark.

Mediana baseline 241,2 ms, massimo 7600,9; M2 finale senza preparazione mediana
234,9, massimo 331,6; preparato mediana 15,3, massimo 15,5. **Non confrontare il
massimo finale a proxy già rapido con il primo avvio M1 come guadagno del codice.**
Il controllo iniziale M2 ha riprodotto il problema a 7,65 s: la preparazione
anticipa il costo, non risolve la configurazione di rete del sistema.

L’obiettivo 0,5–1,5 s con sorgente preparata appare compatibile con questi soli
campioni desktop; non è validato su iOS, rete cellulare, speaker o CarPlay.
La preparazione potrebbe richiedere secondi o non partire su un browser mobile.

## Causa del primo avvio lento

Nel primo campione M1:

- API completa: 5,7 ms, prima del click; URL MP3 già disponibile nel catalogo.
- Click → loadstart: 12,8 ms. La parte frontend non spiega i sette secondi.
- CDP proxyStart → proxyEnd: **7265,7 ms**.
- DNS: 42,9 ms; connessione incl. TLS: 87,7 ms (TLS 45,2 ms, già incluso).
- Invio richiesta → primo header: 83,0 ms, comprensivi di RTT e server remoto.
- Primo chunk notificato da CDP: 7481,7 ms dall’avvio della richiesta media.
- loadstart → loadeddata: 7587,7 ms; dati decodificati → playing: 0,4 ms.

CDP attribuisce il ritardo dominante alla fase proxy. È un indizio della risoluzione
proxy/autodetect del browser o sistema, **non una prova del particolare meccanismo
PAC/WPAD**, né di sette secondi impiegati da SoundHelix. Il controllo con proxy
disabilitato nel solo browser di prova non ha riprodotto il picco; lo stato delle
cache del sistema resta una variabile confondente. Nessuna impostazione globale
proxy/DNS/firewall è stata modificata.

## Fasi osservabili e limiti

`loadCatalog` misura con performance.now richiesta→header, header→JSON e
JSON→validazione. Fastify espone `Server-Timing: catalog;dur=...`, relativo al
solo provider: non comprende RTT, serializzazione, proxy o intera richiesta.
L’ottenimento dello stream è **N/A** come seconda API: il catalogo contiene URL
diretti. Una richiesta HTTP audio successiva rimane necessaria.

L’engine conserva click/comando sorgente/loadstart/loadeddata/playing, preparazione,
attese waiting, intervalli buffered e stato readyState/networkState. `loadstart`
non è un timestamp HTTP. `loadeddata` non è TTFB. L’attesa waiting include rete,
decodifica e scheduling; non va chiamata “solo buffering frontend”.

Il benchmark finale allinea CDP wallTime e performance.timeOrigin **approssimativamente**.
Senza preparazione rileva click→richiesta media 13,0–15,7 ms,
invio→header 75,2–82,5 ms, primo chunk→loadeddata circa 46,6–97,9 ms,
loadeddata→playing 0,5 ms. Quest’ultima attesa al chunk comprende anche altri byte
da ricevere, non misura CPU di decodifica isolata. Nel caso preparato loadeddata
precede il click; il benchmark registra quel costo separatamente.

Resource Timing nella PWA espone le fasi solo quando consentito da origine/TAO
e, in alcuni casi, a fine richiesta. Dati protetti o assenti restano “non disponibili”.
Senza `Server-Timing` del server musicale, il suo tempo di calcolo puro non è
separabile dal RTT. Non si aggira CORS e non si aggiunge un proxy musicale.

`playing` non prova l’uscita audio fisica. “Suono udito” registra un tocco umano
con latenza di reazione: negli E2E il tocco è sintetico e prova solo la telemetria.
Per il tempo al primo suono usare anche una registrazione esterna con riferimento
visibile al click. Non usare screen recording come unica prova del comportamento
a schermo bloccato: può cambiare il comportamento del dispositivo.

## Scelte dopo le misure

- Player M1 conservato, stesso audio e stessi controlli. Nessuna conversione,
  fetch→blob, Web Audio o attesa API aggiunta al gesto di play.
- Preparazione opt-in `preload=auto` della traccia **corrente**, senza autoplay.
  Play riusa la sorgente preparata senza `load()`; `preload` è un suggerimento,
  può essere ignorato e può scaricare l’intero file. Annulla rimuove src e chiama
  load per interrompere il caricamento nativo. Nessuna cache audio del SW.
- `metadata` da solo prepara durata/metadati, non garantisce dati sufficienti
  al primo suono; nessuna promessa di equivalenza ad `auto`.
- Preparazione della **successiva durante playback** valutata e rimandata:
  assegnarla all’unico audio interromperebbe la corrente. Un secondo audio
  contraddice l’architettura; fetch/preload separati richiedono ulteriori misure
  CORS/cache/iOS e possono duplicare traffico. Il preconnect già presente in M1
  è conservato: nei campioni non ha eliminato il picco della fase proxy. Nessun
  nuovo hint/fetch per la successiva è stato aggiunto senza beneficio misurato.
- Token comandi protegge le promise superate; src/load cancella il vecchio
  caricamento nativo al cambio sorgente. Pausa conserva il buffer M1 per riprendere.
- API: timeout 10 s, AbortController su cleanup/retry, nessun risultato obsoleto
  applicato. Audio: deadline 15 s per avvio/rebuffer/preparazione, ripulita a
  playing, pausa, cambio, errore, teardown. Timeout/errore rilascia la sorgente.
  Timer JS possono essere sospesi: deadline rinviata a pagina hidden e nessun
  arresto se il media nativo risulta avanzato con dati pronti. Non sono deadline
  real-time garantite in background, né una soluzione al background playback.
- Eventi limitati a 100, avvii a 20 e Resource Timing a 20; nessun polling che
  tenti di mantenere viva la PWA. Export include UA, timeOrigin, modalità e lifecycle.

## Ripetibilità

`pnpm build`, `pnpm start`, poi `pnpm benchmark` in un altro terminale.
Ogni campione usa un contesto Chromium nuovo, cache HTTP disabilitata e SW
bloccato. Cache OS DNS/TLS/proxy e carico server/PC non sono controllati. Tre
campioni per scenario sono esplorativi, non una distribuzione statistica.
`BENCHMARK_PREPARE=1` attende readyState≥3; anche i fallimenti sono registrati.
`preparationMs` usa eventi e performance.now; `preparationHarnessMs` include
l’automazione e non è usato come tempo del player. `BENCHMARK_DIRECT=1` modifica
solo il browser sperimentale. Usare etichette diverse per conservare ogni prova.

Fonti: [preload audio (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio),
[Resource Timing e restrizioni TAO](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/responseStart),
[Safari media (Apple)](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari).

## Confronto M4 con il player invariato

Il [report M4](playback-feasibility.md) confronta il prototipo isolato con
PlayerEngine M3, senza modificarlo. Dati prima e seconda sessione:
[m4-live.json](performance/m4-live.json),
[m4-final-live.json](performance/m4-final-live.json).

Il primo campione riproduce 7678,6 ms, di cui 7275,1 ms nella fase proxy CDP.
Seconda sessione con scenari ruotati, cinque campioni/scenario: mediana diretto
principale 256,8 ms, lab freddo 259,6 ms; preparati 14,7 e 14,8 ms, dopo
215,7 e 203,5 ms di preparazione. Risoluzione descrittore fredda 14,8 ms client /
0,100 ms server; calda 15,4 / 0,031 ms. Nessun beneficio dimostrato per una
sostituzione dell'engine; cache del descrittore distinta dal buffer audio.

25 avvii iniziali e 5 cambi riusciti nella sessione finale; staging del solo
descrittore conserva il brano corrente in 5/5 prove. URL statici autorizzati,
non sorgenti YouTube. Campioni desktop muti, cache OS/rete non controllate;
nessuna nuova validazione fisica iOS o primo suono.

# Verifica M5

Misure finali reali in [m5-live.json](performance/m5-live.json): cinque campioni
catalogo YouTube Music, p50/p95 cold **508,2/593,5 ms**, warm **1,61/2,11 ms**,
loopback desktop. Cinque blocchi `DISABLED`, zero richieste upstream del provider
media M5; risoluzione stream, preparazione, click→playing e next nativi **non
misurati**, conservati null. Non sono cinque errori HTTP o cinque tentativi falliti
di streaming. Iframe ufficiale separato: ready in 653,6 ms, click→stato playing
1303,5 ms su Carefree, un campione foreground. Nessuna prova al suono/iPhone.
Prima prova iframe con errore di inizializzazione `2` conservata in
[m5-initial-live.json](performance/m5-initial-live.json); passando l'ID iniziale
al costruttore la ripetizione è riuscita. Rete/cache esterne non controllate:
nessuna rivendicazione di miglioramento delle prestazioni.
Il player principale non è stato ottimizzato/modificato in M5.
[Metodo, fattibilità e comandi](youtube-playback-feasibility.md).
