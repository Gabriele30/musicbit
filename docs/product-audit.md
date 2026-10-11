# MusicBit: audit e miglioramenti — 11 ottobre 2026

L’obiettivo è un player personale rapido, affidabile e piacevole da usare ogni giorno.
“Migliore di Spotify e YouTube Music” va tradotto in risultati misurabili per questo
uso: pochi tocchi per ascoltare, continuità della sessione, controllo della propria
libreria, avvio rapido e comportamento prevedibile su telefono. Questo rapporto
analizza il repository locale; non è un confronto aggiornato delle offerte commerciali.

## Architettura compresa

- `apps/web`: React/Vite PWA, app shell offline, audio nativo. Il motore è costruito
  fuori da React e mantiene lo stesso elemento durante navigazione e cambio brano.
- `apps/api`: Fastify, catalogo YouTube Music e risoluzione/proxy audio. Il browser
  chiama direttamente l’URL relativo dello stream nella gesture: nessun await prima di Play.
- `packages/shared`: contratti e validazione dei dati scambiati.
- `experiments/*`: laboratori separati; le restrizioni del vecchio laboratorio M5
  non rappresentano il comportamento del player principale attuale.
- Erano già presenti molte modifiche locali, inclusa l’integrazione playback.
  Sono state preservate. All'avvio dell'audit non erano autorizzate operazioni
  remote; la pubblicazione GitHub è stata richiesta successivamente.

## Criticità risolte

| Priorità | Problema osservato nel codice                                                                                      | Correzione                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Avanzamento sintetico a `duration - 0.5`: fine del brano tagliata, soprattutto con durate stimate diverse dal file | Fine nativa per i flussi normali. Per il solo proxy con durata 1,8–2,2 volte i metadati: durata corretta e fine sintetica a durata + 1 s, senza coda muta                        |
| P1       | `request.raw.signal` non collega la chiusura del client a un AbortController effettivo                             | Cancellazione esplicita sulla chiusura prematura della risposta/socket                                                                                                           |
| P1       | Risoluzione senza deadline, cache non limitata e deduplicazione legata al primo richiedente                        | Cache LRU di 100 descrittori, TTL 5 min, massimo 8 risoluzioni attive, timeout 12 s e cancellazione per singolo sottoscrittore                                                   |
| P1       | URL firmati prossimi alla scadenza ancora riutilizzabili                                                           | Scadenza verificata a ogni accesso con margine di 60 s; invalidazione e nuova risoluzione                                                                                        |
| P1       | Richieste upstream potenzialmente indefinite                                                                       | Deadline di 10 s per le fetch di metadati; 15 s per gli header del proxy, 30 s di inattività nel corpo audio. Nessun limite alla durata di un brano che continua a ricevere dati |
| P1       | Risposta 403 non rilasciata prima del retry; HTML d’errore etichettato come audio e cache pubblica                 | Corpo rifiutato cancellato, un retry per 403/410, errori sanitizzati non cacheabili. Range/suffix Range, HEAD, 416 e If-Range conservati                                         |
| P1       | Eccezioni upstream con possibili URL firmati nei log                                                               | Log con soli codici, nessuna eccezione grezza del proxy                                                                                                                          |
| P1       | Reload perde coda e posizione                                                                                      | Sessione locale validata/versionata, duplicati conservati, posizione ripristinata al primo Play; nessun autoplay o preload al riavvio                                            |
| P2       | Ricerca smontata a ogni cambio schermata, azione principale ambigua                                                | Stato della ricerca mantenuto; dettagli e Play separati; navigazione con URL e pulsante Indietro funzionanti                                                                     |
| P2       | Provider catalogo mostrato come playback sicuramente disponibile                                                   | Copy più prudente; disponibilità catalogo distinta dall’effettivo successo audio, brani non disponibili senza azioni Play/accoda                                                 |
| P2       | Nessuna libreria personale e controlli di sessione essenziali mancanti                                             | Preferiti locali con filtro, Play tutti e gestione; ripeti brano/coda; mescola solo i prossimi brani                                                                             |
| P2       | Avvio album emette una modifica di coda per ogni brano                                                             | Operazioni batch; Play album sostituisce la sessione, Accoda album aggiunge tutti i brani in una sola modifica                                                                   |
| P2       | Mini-player sotto la lista, fuori portata su mobile                                                                | Mini-player fisso sopra la navigazione, spazio riservato per non coprire il contenuto                                                                                            |
| P2       | Metadati e immagine demo mostrati anche ascoltando altri artisti                                                   | Copertina/titolo/artista/album del brano corrente; fallback icona corretto                                                                                                       |
| P2       | Dettagli d’API e strumenti di preparazione nel flusso d’ascolto                                                    | Timing tolti dalla ricerca, preparazione spostata nella Diagnostica, player mobile più compatto                                                                                  |
| P2       | E2E bloccati dalle porte riservate di Windows; test catalogo ancora riferiti al vecchio comportamento              | Porte configurabili e test aggiornati per playback, preferiti, persistenza, navigazione e indisponibilità                                                                        |
| P2       | WebKit può rifiutare Play prima dell’evento media error nel laboratorio                                            | Il laboratorio conserva il codice MediaError già presente, con test di regressione                                                                                               |

La persistenza salva metadati in localStorage, senza audio, token del provider o
diagnostica. Letture corrotte e storage non disponibile non impediscono di ascoltare;
la libreria mostra un messaggio se il salvataggio fallisce. Nessuna sincronizzazione
tra dispositivi. I cambiamenti in un’altra scheda non vengono unificati automaticamente.

## Verifiche

- Baseline: `pnpm check` passava con 145 unit test. Gli E2E iniziali non potevano
  avviare i server: Windows riserva le porte 4096–4595 su questa macchina.
- Dopo le modifiche: `pnpm check` e suite E2E completa, con Chromium e WebKit mobile
  emulati. Totali finali nel [registro verifiche](validation.md).
- Nuovi test: fine brano completa, repeat, shuffle senza interruzione, sessione
  ripristinata e storage guasto, deduplicazione/cancellazione, timeout e limiti cache,
  URL scaduti, Range/HEAD/416/retry, socket reale disconnesso, ricerca preservata,
  preferiti persistenti, navigazione Indietro e riproduzione dall’interfaccia.
- `pnpm smoke:audio`: stream reale AAC/m4a attraverso l’API proxy, elemento audio
  nativo, avanzamento e seek a 10 s in entrambi i browser. Prima rilevazione:
  Chromium 1943 ms a freddo, WebKit 303 ms con cache calda. La sequenza usa una sola
  API, quindi i valori non confrontano le prestazioni dei browser. Sono singoli
  campioni click→playing, non tempi al suono. [Evidenza live](performance/audit-live-audio.json).
- Una seconda prova, mentre erano in esecuzione anche gli E2E, ha rilevato
  2635 ms a freddo in Chromium e 312 ms a caldo in WebKit, con playback e seek
  riusciti. [Seconda evidenza](performance/audit-live-audio-final.json). La variabilità
  conferma che non è ancora dimostrato l’obiettivo di avvio a freddo sotto 2 s.
- Il controllo finale del seek attende anche `seeking=false`, dati disponibili
  e avanzamento oltre 10,2 s: conferma la ripresa dopo il salto, non solo il cambio
  di `currentTime`. Entrambi i browser passano (1980/270 ms all’avvio).
  [Evidenza del seek](performance/audit-live-audio-seek.json).
- Screenshot mobile Player, Libreria e Catalogo prodotti dalla suite e ispezionati
  localmente; controlli per overflow orizzontale inclusi negli E2E.

## Esperienza musicale: intervento successivo

- Home predefinita con feed reale, filtri, accesso per genere, ascolti recenti,
  playlist, artisti seguiti e album salvati. Nessun brano demo viene caricato
  nella coda entrando nella Home.
- Artista con brani popolari, discografia e artisti simili; navigazione tra
  risultati, artista, album e brano. Ricerca distinta per brani/artisti/album.
- Playlist create da brani o da album/artista interi, rinominabili, riordinabili,
  riproducibili in ordine/casualmente ed eliminabili. Preferiti precedenti migrati.
- Cronologia degli ultimi 100 brani, cancellabile; fino a 100 playlist e 1000
  brani per playlist, 1000 preferiti, 200 artisti e 200 album, entro lo spazio locale.
- Autoplay preparato anticipatamente, senza fetch/await nella fine del brano.
  Coda manuale e ripetizione hanno precedenza. Risposte obsolete ignorate;
  interruttore persistente; nessun avvio automatico al reload.
- Il controllo delle durate raddoppiate era necessario: ripristinato per il solo
  proxy con rapporto 1,8–2,2, almeno 30 s di durata nota e tolleranza di 1 s dopo
  la fine. Nessun taglio a durata meno 0,5 s.
- Un `ended` prima di `playing` produce un errore recuperabile e conserva la
  coda, evitando lo scorrimento muto di tutti i brani.

## Compatibilità AAC osservata dal test live

Una prova reale con `khnokW3Mw24` ha trovato un problema che le fixture PCM non
coprivano: WebKit Windows scorreva fino a EOS senza emettere `playing`, mentre
Chromium riproduceva correttamente. Il file AAC-LC frammentato aveva un edit
singolo con priming positivo breve e durata del segmento pari alla durata media.
Una prova controllata ha isolato il problema in quel campo dell’edit.

Il backend ispeziona solo l’init segment (massimo 64 KiB), una volta per descrittore
in cache. Nel caso riconosciuto normalizza `segment_duration=0`, conservando
`media_time` (priming), campioni audio, lunghezza e offset. È la forma indicata
[da Apple per il priming negli audio frammentati](https://developer.apple.com/documentation/http-live-streaming/preparing-audio-for-http-live-streaming).
Nessuna transcodifica o download permanente. Range completi, parziali e suffix
ricevono la stessa rappresentazione; l’ETag originario viene omesso se i byte
sono modificati. Edit complessi, video, versioni diverse e header malformati
restano intatti. Il probe audio richiede ora anche `playing` e `ended=false`,
così il salto immediato alla fine non può risultare un falso successo.

## Criticità ancora aperte e criteri di completamento

| Priorità                    | Lavoro necessario                                       | Criterio verificabile                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1                          | Verifica fisica iPhone con il backend attuale           | Safari e PWA installata: avvio, 30 min di ascolto, blocco schermo, next/previous/seek da lock screen, passaggio Wi-Fi/cellulare, chiamata/interruzione e recupero                                  |
| P1                          | Isolamento del codice remoto eseguito dal provider      | `new Function` e interprete BotGuard sono ancora nel processo API. Isolare in processo/worker con limiti di memoria/CPU e riciclo, senza accesso a segreti dell’host                               |
| P1 se esposto pubblicamente | Controllo accessi, frequenza richieste e traffico audio | Oggi non c’è autenticazione e il limite delle risoluzioni non limita tutti gli stream caldi. Protezione al reverse proxy e limite connessioni/banda prima di una pubblicazione Internet            |
| P1                          | Affidabilità del provider nel tempo                     | Gestire cambiamenti dell’API non ufficiale, 403/429 prolungati, indisponibilità regionale e osservabilità con soli codici sicuri. Il successo di una traccia oggi non garantisce l’intero catalogo |
| P2                          | Backup/import/export e sincronizzazione opzionale       | Recupero dopo perdita del browser, conflitti tra dispositivi risolti e nessun autoplay inatteso; playlist locali implementate                                                                      |
| P2                          | Esperienza di scoperta                                  | Ricerca paginata, storico ricerche e raccomandazioni proprie; feed, cronologia ascolti, pagine artista e autoplay disattivabile implementati                                                       |
| P2                          | Riproduzione avanzata                                   | Valutare normalizzazione volume e transizioni. Il motore attuale non garantisce gapless/crossfade; ogni soluzione deve rispettare il singolo elemento audio e iOS                                  |
| P2                          | Prestazioni misurate su telefono/rete reale             | Almeno 30 campioni a cache fredda/calda, p50/p95 separati; obiettivi iniziali da verificare: p95 cold < 2 s, warm < 700 ms, nessuna interruzione durante navigazione                               |
| P2                          | Documentazione storica                                  | Altri documenti M1–M5 contengono ancora descrizioni metadata-only riferite al laboratorio. Il README corrente e questo audit sono il punto d’ingresso aggiornato                                   |

Non è dimostrata superiorità generale sui servizi commerciali. Il risultato di
questo intervento è una base locale più completa, affidabile e verificata, con
limiti espliciti per ciò che richiede dispositivi fisici o nuove scelte di prodotto.

## Primo redesign di prodotto

La [roadmap di design](product-design-roadmap.md) distingue il primo intervento
implementato dalle fasi successive. Home e pagine artista/album privilegiano la
musica; mobile usa tre sezioni, mini-player e player a schermo intero con coda
accessibile dalla barra superiore. Le azioni secondarie sono raccolte in un
dialog condiviso, con gestione del focus WebKit verificata. Il desktop mantiene
barra laterale e mini-player inferiore.

Ricerca, tab della libreria e scroll sopravvivono ai cambi di schermata. Le demo
non sono richieste né caricate nella coda durante il percorso normale; sono
disponibili nella diagnostica e nel player esplicito `?screen=player&demo=1`.
Il redesign non modifica il motore audio, il proxy AAC o la protezione sulle
durate raddoppiate. Le verifiche complete sono nel [registro](validation.md).
