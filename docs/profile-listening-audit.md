# Sessione reale: cinque artisti e profilo esistente

Verifica del 24 ottobre 2026 con Playwright, viewport iPhone e il profilo reale
già presente sul server. Sono stati usati catalogo, autenticazione, libreria,
proxy e file audio reali. Nessuna risposta audio o di catalogo è stata simulata
nelle sessioni qui descritte.

## Ambiente e dati

Il servizio Tailscale non era raggiungibile dal PC. L'accesso SSH già configurato
ha permesso un tunnel temporaneo verso il web server MusicBit, senza cambiare
porte pubbliche o distribuzione. La prima prova usa la versione pubblicata;
le successive usano il frontend locale compilato e lo stesso backend remoto,
con lo stesso account reale. Questo permette di verificare le correzioni del
client senza pubblicarle. Le correzioni backend sono state verificate nei test
locali: **non sono installate sul server**.

Snapshot prima e dopo confermano che preferiti, playlist, artisti seguiti e
preferenze esplicite degli artisti non sono cambiati. Cronologia e segnali di
ascolto/skip sono stati aggiornati dal normale uso. La cronologia passa da 43
a 48 brani distinti: molti dei brani provati erano già stati ascoltati.
Gli snapshot privati e le prove grezze sono soltanto negli artefatti ignorati
da Git; non contengono password o cookie esportati.

## Ascolti completati

Sono stati riprodotti e campionati **19 brani distinti**, con segnale decodificato
non nullo. Non sono diciannove ascolti integrali.

| Artista richiesto    | Brani riprodotti                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| MadMan               | Blue Sky; Veleno 6; Veleno 7; Ciò Che Fa Per Me                                                         |
| Gemitaiz             | Ciao Baby; Senza Di Me; Forte                                                                           |
| Toni Zeno            | C'è Nessuno? Pt.2; DISISA; TRE SOGNI; RIEMPIRE UNO STIVALE                                              |
| Salmo                | IL CIELO NELLA STANZA (feat. NSTASIA)                                                                   |
| Marracash            | Nulla Accade                                                                                            |
| Scoperte dalla radio | 100 MESSAGGI; BUIO DAVANTI; Morto Mai; MOLOTOV, di Lazza; STUPIDO e Amici, di Massimo Pericolo/Crookers |

Per ogni artista sono stati alternati ascolti di circa trenta secondi, skip
dopo tre secondi e ascolti intermedi di dodici/diciotto secondi, dove il
fornitore consentiva la riproduzione. Salmo e Marracash sono stati verificati
anche dalla cronologia, circa trentacinque secondi ciascuno.

Una prova lascia **IL CIELO NELLA STANZA** terminare interamente, a velocità 1×,
senza seek: durata AAC 186,21 secondi, partenza osservata a 0,32 secondi,
campionamento fino all'evento di fine. Parte quindi **Nulla Accade** dalla coda
mescolata, con nuova sorgente, clock positivo e segnale presente. Nessun ritorno
all'indietro nei campioni della traccia intera. La durata AAC di Nulla Accade
è 232,41 secondi.

Le prove verificano sorgente effettiva, clock, errori nativi, pausa, seek e
segnale con un analizzatore Web Audio aggiunto soltanto dalla strumentazione.
Lo stesso elemento audio sopravvive ai cambi di pagina della sessione; una
ricarica completa della pagina avvia naturalmente una nuova istanza dell'app.

Il confronto fra durata nativa e `/info` per dodici brani principali non mostra
scarti superiori a due secondi. Per Blue Sky: 187,62 secondi nativi e 188 secondi
risolti dal server. Nessun raddoppio nelle durate confrontate. Questo confronto
non sostituisce un ascolto integrale della coda finale di ogni traccia.

## Shuffle e consigli

Dieci azioni reali “Mescola a seguire” producono dieci ordini diversi. A ogni
azione restano uguali l'insieme dei brani, comprese le ripetizioni accodate
esplicitamente, e la posizione della traccia corrente. La musica in corso
continua. Questa è una verifica empirica di integrità; dieci campioni non
dimostrano da soli l'uniformità statistica dello shuffle.

I consigli osservati comprendono Gemitaiz, Salmo, Toni Zeno, Marracash, Lazza,
Fabri Fibra e Massimo Pericolo: una continuità plausibile con gli ascolti
richiesti. Non è una certificazione soggettiva di ogni abbinamento musicale.

È emerso però un difetto concreto: la radio ha proposto e riprodotto
**100 MESSAGGI → BUIO DAVANTI → Morto Mai → MOLOTOV**, tutti di Lazza, nonostante
lo skip di BUIO DAVANTI dopo circa tre secondi. Il limite per artista ripartiva
a ogni nuova richiesta e non teneva conto dell'artista attualmente in ascolto.

La correzione passa quel contesto al ranking sia nel client sia nella radio
backend. La prima proposta preferisce un altro artista se ci sono alternative;
con un catalogo di un solo artista non restituisce una radio vuota.
La ripetizione reale mostra una prima proposta di artista diverso in tutti e
quattro i passaggi verificati. Le regressioni coprono anche collaborazioni e
un artista molto favorito dal profilo storico.

## Problemi importanti osservati

### Cambio di traccia nella versione pubblicata

Nella prima prova Blue Sky resta senza avanzamento per i primi venti secondi
osservati. Dopo lo skip, Veleno 6 riesce ad avviarsi; il successivo passaggio a
Veleno 7 resta in caricamento e termina con “Audio non disponibile”. Il flusso
HLS ha durata infinita e nessun intervallo cercabile nel Chromium disponibile.

La correzione locale già introdotta nell'audit precedente recupera verso AAC.
Ripetendo MadMan con quel client, tutti e quattro i brani completano i campioni:
circa 4,05 secondi fino al progresso verificato di Blue Sky e 0,40/0,63/0,56
secondi per i successivi. La cache era già popolata: non sono tempi di avvio a
freddo su rete mobile.

### Il fornitore rifiuta parte del catalogo

Davide (feat. Coez) e NEON - Le Ali non completano l'avvio. Le richieste reali
restituiscono 503; il codice **PROVIDER_RESTRICTED** è stato letto direttamente
dalle risposte audio e `/info` di Davide. Il servizio richiede una verifica di
accesso dal server. I file già in cache restano utilizzabili.

In un controllo di dodici suggerimenti, undici restituiscono audio dalla cache
e uno, NON SEI PIÙ TU, restituisce 503. In prove successive anche Morto Mai
(Piano Solo) e altre proposte risultano non disponibili. La pertinenza musicale
del nome non garantisce quindi che una proposta possa realmente partire.

Correzioni locali:

- Il player conserva il motivo comunicato dal server e lo mostra anche quando
  l'errore nativo arriva prima della risposta di metadati. La verifica avviene
  anche per il flusso continuo HLS. Il messaggio è stato verificato realmente
  su Davide dopo la ricompilazione.
- Un errore del solo recupero metadati non interrompe audio funzionante; un
  errore del brano precedente non viene trasferito al successivo.
- Durante una restrizione nota, anche la radio progressiva sceglie soltanto
  brani personali effettivamente in cache, rispettando le esclusioni della
  coda e il profilo. Comunica il ripiego e torna al catalogo normale quando
  la restrizione scade. Questo percorso backend è coperto dai test locali.

La restrizione esterna **non è risolta**. Nella ripetizione con backend remoto
non aggiornato è stato necessario selezionare i suggerimenti disponibili:
fra i quattro scelti, Ciao Baby, Forte, STUPIDO e Amici hanno segnale e progresso
regolari. Due prime proposte non erano disponibili, quindi quei passaggi non
vengono contati come quattro avanzamenti automatici riusciti.

### Metadati e ambiguità della discografia

Le discografie di MadMan e Gemitaiz mostrano album con “Artista non indicato”.
Il normalizzatore ora eredita l'artista della pagina per album e brani senza
crediti, conservando i crediti espliciti delle collaborazioni e degli artisti
correlati. Il test riproduce la struttura osservata nel catalogo reale.

Resta una questione di presentazione: la scheda Gemitaiz contiene versioni
omonime con ID diversi, ad esempio Ciao Baby e Davide. Non sono state eliminate
automaticamente soltanto in base al titolo, per evitare di perdere versioni
distinte. Servono informazioni visive migliori per distinguere audio e video.

## Verifica conclusiva e limiti

- `pnpm check`: **341 test in 53 file**, lint, tipi e build superati.
- `pnpm test:e2e`: **109 scenari superati**, 7 HLS esclusi su Windows WebKit.
- Cache del profilo al termine: 791.324.786 byte, 273 tracce, quota di
  5.000.000.000 byte, nessuna preparazione pendente. Le tracce erano in gran
  parte già presenti prima dell'audit.
- Preferiti, playlist, artisti seguiti e preferenze esplicite invariati.

Errori dell'automazione conservati ma non conteggiati come difetti dell'app:
un risultato album omonimo selezionato al posto dell'artista Salmo, un tentativo
di navigazione prima del ripristino del player e la selezione ambigua di due
bottoni Davide. La prova di Salmo è stata completata dalla cronologia reale.
La nuova fixture E2E di errore audio blocca il service worker per rendere
intercettabili le risposte controllate; le altre prove PWA mantengono il worker.

Questi test Windows non certificano l'uscita acustica dell'iPhone, CarPlay o il
blocco fisico dello schermo. Nessun deploy o accesso a GitHub è stato eseguito.

Evidenze locali: `artifacts/profile-listener/summary.json`,
`deployed-probe.json`, `deployed-third.json`, `listening-session.json`,
`history-listening.json`, `full-track-shuffle.json`, `radio-listening.json`,
`radio-availability.json`, `radio-availability-tail.json`,
`after-fixes-provider-limitation.json`, `variety-after-fix.json`,
`duration-check.json`, `check-final.log`, `e2e-final.log` e schermate. Tutta la cartella è ignorata da Git.
