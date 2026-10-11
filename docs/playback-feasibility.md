# M4 · Fattibilità del motore di riproduzione

Valutazione del 10 ottobre 2026, branch `codex/m4-playback-engine`.

## Decisione

**Conservare PlayerEngine e HTMLAudioElement nativo.** Il prototipo dimostra
ricerca → identità → sorgente autorizzata → preparazione → riproduzione, ma non
dimostra un vantaggio rispetto al player M2/M3. Il beneficio della preparazione
è già disponibile nel principale. Nessun file di `apps/web` o del provider
YouTube M3 è stato modificato.

Il collegamento è fattibile per un catalogo con sorgenti autorizzate compatibili.
**Non è dimostrata la fattibilità dell'audio YouTube Music nella PWA a schermo
bloccato.** Non sono state estratte né provate sorgenti multimediali YouTube.
URL tecnicamente disponibile, diritti sui contenuti e permesso di accesso al
servizio sono verifiche diverse.

## Analisi YouTube.js e sorgenti

Analizzati i sorgenti **installati** di `youtubei.js` 18.1.0, senza aggiornamenti:
`core/mixins/MediaInfo.js`, `utils/FormatUtils.js`, `parser/parser.js` e
`parser/classes/misc/Format.d.ts`. Confronto con
[chiamate/parser](https://ytjs.dev/guide/advanced-usage),
[selezione formato](https://ytjs.dev/api/youtubei.js/namespaces/FormatUtils/functions/chooseFormat)
e [Player](https://ytjs.dev/api/classes/Player). Nessuna connessione a GitHub.

| Informazione                                                  | Disponibilità nella libreria                                                                       | Conseguenza                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Titolo, artista, ID, miniature, album, durata quando presente | Ricerca/browse/next, normalizzati da M3                                                            | Un ID di catalogo non è un URL audio                                   |
| Stato del contenuto                                           | `playability_status` nella risposta player                                                         | Non ottenuto dalla ricerca; non equivale a licenza                     |
| Formati                                                       | `formats`/`adaptive_formats`, MIME, bitrate, audio/video, sample rate, durata approssimata e range | Verificare codec e trasporto separatamente                             |
| URL/validità                                                  | `url` opzionale; `streaming_data.expires` deriva da `expiresInSeconds`                             | Non trattare URL temporanei come permanenti                            |
| Manifest                                                      | URL DASH/HLS opzionali, specialmente live                                                          | Non ogni risultato offre HLS; non è uno stream continuo personalizzato |
| Ulteriori requisiti                                           | Campi cipher/signature, dati player, possibili token e campi DRM                                   | Limiti analizzati, non implementati o aggirati                         |

`MediaInfo` espone anche selezione formato, manifest e download. M4 non usa
questi percorsi. Restano `retrieve_player:false` e il fetch M3 limitato a
`search/browse/next`: nessuna chiamata a `getInfo`, `getBasicInfo`, `download`,
`decipher`, `/player` o host media YouTube; nessun cookie/account/token raccolto.

InnerTube è un'API privata. La [FAQ del progetto](https://ytjs.dev/guide/faq)
segnala possibili blocchi dell'IP del server. Parser, risposte e requisiti possono
cambiare senza un contratto pubblico di servizio. Cache e deduplicazione non
risolvono un blocco, una rimozione o una modifica upstream.

Un URL eventualmente restituito può non funzionare dal dispositivo: scadenza,
condizioni CDN/sessione/rete, codec e restrizioni richiederebbero verifiche
ulteriori. Sono rischi da valutare, **non risultati di test media YouTube M4**.

Le demo SoundHelix sono associate per ID esatto e mantengono artista, fonte,
permesso e attribuzione. I benchmark remoti riproducono Song 1 e, nei cambi,
Song 2 direttamente in `<audio>`. Song 3 è risolvibile come in M1, ma non è inclusa
nel benchmark remoto M4. Gli E2E usano un tono PCM originale di 30 secondi,
via HTTP Range locale, senza dipendere da SoundHelix o YouTube.

La [pagina dell'autore](https://www.soundhelix.com/audio-examples) consente l'uso
degli esempi con attribuzione a SoundHelix e all'artista; non si presume una
licenza CC. In M4 la pagina ha risposto HTTP 500 pur contenendo il testo del
permesso; gli MP3 hanno risposto 206 e sono stati riprodotti. Il limite della
pagina è distinto dal buon esito dell'audio.

## Restrizioni e conformità

Le [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
per YouTube API Services vietano API non documentate senza permesso (III.D.7),
download/cache audiovisiva senza approvazione (III.E.1), separazione/promozione
delle componenti audio/video e player in background (III.I.7–9), oltre
all'aggiramento di restrizioni geografiche (III.I.13). Il percorso ufficiale non
soddisfa automaticamente l'obiettivo di un player solo audio nascosto.
Queste policies riguardano le API ufficiali e non autorizzano InnerTube.
I [termini generali YouTube](https://www.youtube.com/static?template=terms)
limitano anche l'accesso automatizzato senza permesso. Una libreria open source
non concede diritti sui contenuti o sul servizio.

Per un rilascio vanno chiariti separatamente accesso al catalogo e licenza/trasporto
dell'audio. Un file fornito direttamente dall'avente diritto può essere una
sorgente indipendente dopo verifica del permesso; non deve essere ricavato
automaticamente da YouTube. Il prototipo non abbina per titolo/artista e restituisce
`NO_AUTHORIZED_SOURCE` per gli ID YouTube, senza tentarne l'estrazione.

## Architettura e contratti

```text
Lab mobile separato, /__playback/ (HTTP 4181 oppure HTTPS 4453)
  → ricerca demo oppure CatalogService M3 (YouTube, metadati)
  → PlaybackReference { catalogProvider, catalogId }
  → PlaybackResolver → PlaybackProvider
      → AuthorizedDemoPlaybackProvider: mapping esplicito demo
      → sorgente / indisponibilità / errore tipizzato
  → selezione risolta, senza modificare l'audio corrente
  → preparazione facoltativa nello stesso audio, a riproduzione ferma
  → gesto Play → src/load/play sincroni → HTMLAudioElement persistente
```

`packages/shared/src/playback.ts` definisce `PlaybackProvider`, indipendente da
`CatalogProvider`: identità + AbortSignal → disponibilità, URL, MIME, progressive/HLS,
durata opzionale, `validUntil`, fonte e permesso. `validUntil:null` significa
scadenza non dichiarata, non disponibilità perpetua. Durata musicale e validità
dell'URL sono separate.

`available` significa descrittore autorizzato disponibile: il resolver non fa
HEAD/fetch audio e non garantisce una risposta dal server remoto. Errori successivi
di rete/decodifica sono registrati dal media nativo. La validazione di struttura,
URL, identità, permesso dichiarato e scadenza non certifica legalmente un provider.

Cache dei soli descrittori in memoria, massimo 100 chiavi; TTL configurabile
`PLAYBACK_TTL_MS` (60 s, 0 disabilita storage). Scadenza effettiva
`min(TTL, validUntil - 5 secondi)`, ricontrollata prima di play/preparazione/cambio.
Deduplicazione per provider/identità, massimo 16 richieste distinte attive;
cancellazione di un subscriber senza interrompere gli altri, abort upstream
quando non ne rimangono. Riusa la utility M3 senza modificarla.

Timeout server `PLAYBACK_TIMEOUT_MS` (10 s), client 12 s con AbortController
compatibile Safari, audio 15 s a pagina visibile. Errori/indisponibilità non sono
memorizzati. Nessun rinnovo silenzioso dell'URL durante il brano: un futuro
provider temporaneo dovrà garantire anche i Range successivi e progettare il
rinnovo dopo misure specifiche. Nessun retry infinito, conversione o proxy audio.

API **solo del lab**, non registrate in `buildApp`:

| Metodo / percorso                                      | Input e risultato                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET `/__playback/health`                               | Stato del laboratorio                                                                           |
| GET `/__playback/api/search?q=SoundHelix&catalog=demo` | Candidati; `catalog=youtube` usa solo i metadati M3                                             |
| POST `/__playback/api/resolve`                         | `{"catalogProvider":"soundhelix-demo","catalogId":"soundhelix-1"}` → risoluzione e timing cache |

Schema input; proprietà aggiuntive e URL arbitrari rifiutati. Indisponibilità di
dominio HTTP 200; input 400, timeout 504, busy 429, errore provider 503,
cancellazione 499 se è ancora possibile rispondere. `Server-Timing` misura solo
il resolver; il client misura il round trip fino al JSON. Log raw disabilitati,
codici stabili e diagnostica limitata, senza testo di ricerca, credenziali, header
o URL multimediali/query negli export.

Una futura integrazione dovrebbe adattare una sorgente autorizzata al contratto
del player principale, mantenendo engine ed elemento. Non introdurre un secondo
motore nella PWA. Il controller del lab serve al confronto, non è un sostituto.

## Prestazioni misurate

Windows, Node 24.14.0, Chromium 156.0.8078.4; output muto. Prima sessione:
[m4-live.json](performance/m4-live.json). Seconda con ordine dei cinque scenari
ruotato tra ripetizioni: [m4-final-live.json](performance/m4-final-live.json),
10 ottobre 2026, 16:55 UTC. Cinque campioni/scenario; p50/p95 nearest rank
(n=5: p95 = massimo), senza inferenze di SLA.

Contesto browser e resolver nuovi per campione. “Fredda/calda” riguarda **solo
la cache del descrittore server**: miss contro hit ottenuto con una risoluzione
prima del test. Cache HTTP disabilitata e SW bloccato; il buffer preparato è
quello dello stesso audio. Cache OS/DNS/TLS/proxy, rete e carico remoto non
controllati. Nessuna misura di suono fisico o test iPhone.

| Scenario finale                   | Avvii riusciti | Click Play → playing p50 / p95 | Preparazione prima del click p50 / p95 | loadstart → loadeddata p50 / p95 |
| --------------------------------- | -------------- | ------------------------------ | -------------------------------------- | -------------------------------- |
| Principale invariato, diretto     | 5/5            | 256,8 / 371,1 ms               | —                                      | 240,1 / 357,5 ms                 |
| Principale invariato, preparato   | 5/5            | 14,7 / 15,7 ms                 | 215,7 / 265,5 ms                       | 201,2 / 249,8 ms                 |
| Lab, descrittore freddo, diretto  | 5/5            | 259,6 / 303,7 ms               | —                                      | 243,1 / 287,3 ms                 |
| Lab, descrittore caldo, diretto   | 5/5            | 246,9 / 327,5 ms               | —                                      | 230,7 / 312,2 ms                 |
| Lab, descrittore caldo, preparato | 5/5            | 14,8 / 15,7 ms                 | 203,5 / 214,5 ms                       | 186,4 / 198,1 ms                 |

| Risoluzione sorgente            | Client round trip p50 / p95 | Resolver server p50 / p95 |
| ------------------------------- | --------------------------- | ------------------------- |
| Fredda                          | 14,8 / 15,8 ms              | 0,100 / 0,447 ms          |
| Calda, prima del play diretto   | 15,4 / 16,4 ms              | 0,031 / 0,040 ms          |
| Calda, prima della preparazione | 14,4 / 15,8 ms              | 0,034 / 0,043 ms          |

Si misura un lookup di URL statici, **non l'ottenimento di uno stream YouTube o
di un servizio con URL firmati**. La cache riduce il lavoro server, ma qui non
produce un beneficio client distinguibile dalla variabilità del round trip.
Non viene trasferita alcuna ottimizzazione al principale.

Sessione finale: 25/25 avvii iniziali, 5/5 cambi espliciti alla Song 2, 20/20
descrittori demo disponibili (15 selezioni + 5 successive), 15/15 risoluzioni
YouTube correttamente non disponibili, zero errori inattesi. I casi non disponibili
non sono tentativi di audio YouTube. Timeout, cancellazione e fallimento/recupero
HTTP audio hanno test deterministici separati.

Prima sessione, primo avvio principale: **7678,6 ms**, di cui **7275,1 ms nella
fase proxy CDP**, click → richiesta media 14,6 ms, invio → header 69,7 ms, primo
chunk → loadeddata circa 124,1 ms. Non è prova di 7 s di elaborazione remota.
Il resto della sessione è più rapido; la seconda non riproduce il picco.
**Non attribuire la differenza al prototipo:** ordine/connessioni/cache di sistema
confondono il confronto.

Seconda sessione: click → richiesta media circa 12,5–17,1 ms; mediane invio →
header remoto 83,4–90,4 ms fra gli scenari, comprensive di RTT e server, non
solo elaborazione remota. Senza telemetria SoundHelix non si separano.
Primo chunk → loadeddata allinea approssimativamente CDP wallTime e timeOrigin,
non misura CPU di decodifica isolata. `loadstart` è un proxy, `loadeddata` indica
dati decodificati, `playing` non prova suono fisico. La preparazione viene misurata
prima del click e non nascosta nel dato di avvio.

Il flusso ha **due gesti**: selezione/risoluzione, poi Play. Il round trip comprende
fetch/parsing; click→playing parte dal pulsante Play, non dalla selezione della
ricerca. Ricerca e riflessione dell'utente non vengono nascoste in una promessa
di avvio in un solo tocco. I tempi di ricerca sono esportati separatamente.

## Prossima traccia

Risolvere il descrittore successivo durante playback ha conservato sorgente e
avanzamento in **5/5** prove reali, senza nuove richieste audio nell'intervallo
osservato. Cambio successivo alla Song 2: **412,9 ms p50 / 515,3 ms p95**.
Non precarica byte e non garantisce gapless o continuità iOS.

Assegnare la prossima sorgente all'unico audio interromperebbe la corrente.
Un secondo audio/fetch potrebbe duplicare traffico e richiede ulteriori misure
cache/CORS/gesto/iOS: non implementato. Risolvere troppo presto un URL temporaneo
può essere controproducente; il lab ricontrolla validità e richiede nuova
risoluzione se scaduta. `ended` usa solo un descrittore già pronto, senza await.

## Safari iOS, HLS e raccomandazione

Safari può richiedere un gesto per l'avvio audio: risoluzione prima, `audio.play()`
nello stack del pulsante. `preload` è un suggerimento, non garanzia o limite
ai byte; `canPlayType` è preliminare, non prova di rete/decodifica. Riferimento:
[indicazioni media Safari Apple](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari).

Sospensione JS, perdita della scheda, risparmio energetico, cambi rete e route
Bluetooth/CarPlay richiedono dispositivo fisico. Deadline rinviata a pagina hidden
e verifica di avanzamento nativo evitano di scambiare automaticamente eventi
ritardati per timeout; non mantengono viva la pagina. La diagnostica espone buffer,
readyState/networkState, waiting, errori, azioni Media Session, lifecycle,
user agent e standalone. Non usa `AbortSignal.any/timeout`, per compatibilità Safari.

Il lab ha manifest separato, **senza SW/offline**, e non altera installazione o
cache principale. HTTPS LAN con CA/SAN e flusso remoto verificato dal PC:
[m4-https-smoke.json](performance/m4-https-smoke.json). Non prova fiducia o
raggiungibilità iPhone. [Checklist M4](playback-ios-checklist.md),
[registro ancora da compilare](ios-test-report.md).

| Motore                                 | Valutazione M4                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| HTMLAudioElement + MP3/AAC autorizzato | **Raccomandato**: nessuna conversione, engine M2 conservato, lab equivalente                             |
| HLS nativo autorizzato                 | Valutare se serve una timeline continua; segmentazione/buffer e costi server possono aumentare l'avvio   |
| HLS continuo server-side               | Esperimento M2 con toni originali conservato; M4 non dimostra benefici HLS o funzionamento fisico iPhone |
| Web Audio, fetch→blob, MSE sostitutivo | Nessun beneficio dimostrato; complessità e rischi di sospensione/CORS aggiuntivi                         |
| Estrazione audio YouTube               | Non implementata né raccomandata come motore: accesso, diritti e stabilità irrisolti                     |
| Player ufficiale YouTube visibile      | Prodotto distinto soggetto ai termini; non sostituisce l'audio PWA a schermo bloccato                    |

## Ripetibilità e limiti aperti

`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm format:check`, `pnpm test:e2e`.
Esito finale: **108 Vitest e 30 E2E superati**, oltre a lint/typecheck/build/stile.
Test M1–M3 conservati; nuovi test per resolver/validità/concorrenza/cancellazione,
gesto sincrono, preparazione, indisponibilità, cambio nativo e failure/recovery HTTP.
Gli E2E Chromium/WebKit non sono prove fisiche. Avvio: [README](../README.md).

Con `pnpm start` attivo (preview principale 4173), in un secondo terminale:

```powershell
$env:PLAYBACK_BENCHMARK_LABEL = 'm4-mia-rete'
$env:PLAYBACK_BENCHMARK_RUNS = '5'
pnpm benchmark:playback
```

Il benchmark crea/chiude un proprio lab HTTP loopback su porta effimera e non
salva audio. Debian: `PLAYBACK_BENCHMARK_LABEL=m4-mia-rete pnpm benchmark:playback`.
Probe reali espliciti, esclusi dalla CI. Regressione live M3, dettagli e continuità
demo: [m4-main-catalog-regression.json](performance/m4-main-catalog-regression.json).

Restano aperti sorgente autorizzata più ampia delle demo, rinnovo URL durante
il brano, confronto HLS su iPhone e validazione fisica M4/CarPlay. Nessun login,
database, playlist avanzate o raccomandazioni. Docker/HTTPS pubblico non verificati
in M4; il lab è escluso dai runtime di produzione. Nessun push o PR.
