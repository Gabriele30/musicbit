# M3: misure catalogo e prove reali

10 ottobre 2026, Windows, Node 24.14.0, pnpm 11.25.0, `youtubei.js@18.1.0`.
Report grezzo: [catalog-m3.json](performance/catalog-m3.json), esecuzione
16:21:44–16:21:52 UTC. Queste prove contattano il servizio reale e sono separate
da Vitest/E2E deterministici. Nessun audio YouTube richiesto o riprodotto.

## Prima e dopo la cache

`pnpm benchmark:catalog`: cinque coppie cold/warm per tipo, query costante pubblica
“Johann Sebastian Bach”, limite cinque. Ogni campione cold avvia una nuova istanza
API/provider/sessione locale/cache RAM. Warm ripete immediatamente la stessa
richiesta nella stessa istanza. HTTP su loopback; il tempo totale comprende
fetch/risposta/JSON e il tempo server misura cache/provider/normalizzazione.
Le chiamate sono sequenziali; DNS, TLS, cache OS, connessioni del processo e cache
del servizio remoto non sono azzerati. “Cold” significa cache metadati vuota,
non una rete interamente fredda.

| Tipo    | Senza cache HTTP p50 / p95 | Cache calda HTTP p50 / p95 | Senza cache server p50 / p95 | Cache calda server p50 / p95 |
| ------- | -------------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| Brani   | 457,4 / 605,1 ms           | 1,58 / 2,06 ms             | 455,5 / 591,3 ms             | 0,033 / 0,050 ms             |
| Artisti | 443,9 / 533,6 ms           | 1,19 / 1,25 ms             | 438,7 / 531,7 ms             | 0,030 / 0,037 ms             |
| Album   | 512,3 / 603,6 ms           | 1,09 / 1,18 ms             | 510,8 / 601,9 ms             | 0,025 / 0,028 ms             |

15 ricerche cold: 200, cinque risultati ciascuna, cache miss. 15 warm: 200,
cache hit, stessi conteggi. Zero fallimenti in questa esecuzione. p50/p95 nearest
rank: con cinque campioni p95 coincide con il massimo, senza robustezza statistica.
Il guadagno osservato riguarda richieste identiche entro TTL; query diverse o
cache scaduta richiedono il servizio. Non è una promessa di latenza o disponibilità.
Non ci sono misure M1/M2 di ricerca, perché la funzione non esisteva.

La durata API mostrata nell’interfaccia è `timing.elapsedMs`, non click→risultati:
il debounce 350 ms, rete client/iPhone, rendering e miniature restano esclusi.
Non viene modificata né rivalutata la latenza al suono del player M2.

## Probe dettagli contro servizio reale

Una chiamata dettaglio per il primo elemento di ogni tipo, dopo la prima coppia:

| Dettaglio | Esito | Durata server | Controllo                            |
| --------- | ----- | ------------- | ------------------------------------ |
| Brano     | 200   | 128,5 ms      | Metadata-only, senza audioUrl        |
| Artista   | 200   | 391,3 ms      | Metadata-only, senza audioUrl        |
| Album     | 200   | 308,7 ms      | Metadata-only, 30 brani normalizzati |

Prima del benchmark sono riusciti anche tre probe API ricerca e tre dettagli,
inclusi miniatura, durata brano e tracklist album. Non si generalizza l’esito ad
altri cataloghi, IP, regioni o date. Parser incompleto/blocchi/risultati mancanti
restano possibili; [limiti del servizio](catalog-compliance.md).

## Ripetere senza modificare l’evidenza

```powershell
pnpm build
$env:CATALOG_BENCHMARK_RUNS = '10'
$env:CATALOG_BENCHMARK_OUTPUT = 'artifacts/catalog-mia-rete.json'
pnpm benchmark:catalog
Remove-Item Env:CATALOG_BENCHMARK_RUNS
Remove-Item Env:CATALOG_BENCHMARK_OUTPUT
```

Non serve avviare un’API esterna: lo script apre istanze loopback su porte libere
e le chiude. Il percorso di output deve avere una directory esistente; `artifacts`
è ignorata da Git. Su Debian usa variabili prima del comando. Default cinque
campioni per tipo, intervallo 1–10; gli errori HTTP vengono registrati separatamente
ed esclusi dai percentili. Con risultati vuoti, probe falliti o HTTP non 200 lo
script termina con codice non zero. Per raccogliere più esecuzioni cambiare output,
senza usare il benchmark come polling periodico.

## Regressione e iPhone

`pnpm smoke:catalog` è un controllo live della build su preview: richiede
`pnpm start` e conserva un solo audio SoundHelix mentre apre ricerca e dettagli
reali. Prova completata su `https://192.168.1.69:4443`, usando
`MUSICBIT_BASE_URL` nella shell: CA/SAN verificati da Node, contesto sicuro,
service worker registrato, 15 risultati, API 565,0 ms, posizione demo
0,47→1,80 s durante la ricerca, nessun errore e nessun Play di catalogo.
[Report](performance/catalog-live-smoke.json), screenshot `artifacts/catalog-live-m3.png`.
Il browser desktop usa il pin SPKI del solo certificato locale; non installa
fiducia nel sistema o sul telefono. Volume zero: non prova uscita fisica o iOS.
Per altra origine HTTP usare `MUSICBIT_BASE_URL=http://127.0.0.1:4173`; l’opzione
HTTPS di questo script è dedicata alla CA del laboratorio locale. Cambiare
`CATALOG_SMOKE_OUTPUT` per conservare un report senza sovrascrivere l’evidenza.

Vitest verifica TTL/LRU/dedup, subscriber indipendenti, abort ultimo subscriber,
timeout anche con adapter bloccato, errori non memorizzati, validazione e privacy.
Un test HTTP reale locale verifica cancellazione dopo disconnessione del client.
E2E Chromium/WebKit emulati verificano debounce, risposte fuori ordine, errori,
album/artisti/dettagli e continuità di un solo audio demo mentre si cerca.
I mock del catalogo bloccano il service worker per consentire routing deterministico;
la suite player separata mantiene il test del vero SW/app shell offline.

Le conferme iPhone M2 sono riferite dall’utente; M3 richiede nuova prova fisica
con la [checklist](ios-checklist.md). CarPlay rimane non testato. Non vengono
dichiarate misure di primo suono o successi hardware M3.
