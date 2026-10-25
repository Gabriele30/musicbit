# Prova con ascolti reali

La prova successiva sul profilo esistente, con i cinque artisti richiesti,
shuffle e un ascolto integrale, è in [profile-listening-audit.md](profile-listening-audit.md).

Verifica locale del 24 ottobre 2026, successiva a `black-ui-audio-audit.md`.
Playwright ha usato l'interfaccia mobile della build di produzione, il vero
catalogo YouTube Music e il backend MusicBit con risoluzione, proxy e cache AAC.
Nessuna risposta del catalogo o richiesta audio è stata simulata nelle sessioni
descritte qui. Account e archivio di prova sono separati dai dati dell'utente.
Nessuna pubblicazione su GitHub o distribuzione sul server.

## Brani e azioni

Sono stati campionati **19 brani reali distinti**, non ascoltati integralmente.
Il segnale decodificato è stato misurato con un analizzatore Web Audio di prova,
insieme a sorgente effettiva, clock nativo, stato di pausa, errori e numero di
elementi audio. L'analizzatore non fa parte del codice dell'applicazione.

| Sessione                       | Brani                                                                                                                                                              | Verifica                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRUVATURA, Toni Zeno           | DISISA; UNA SARPA; TRE SOGNI; MONTESCUDERI; CALAFARINA; RIEMPIRE UNO STIVALE; SETTE PORTE DI FERRO; PIZZO; CASTELLUCCIO; TROVARE L'USCITA; IL DISTACCO; MOLTISANTI | Tutte le dodici tracce selezionate dalla UI, circa cinque secondi di campioni per traccia, clock crescente e segnale non nullo. Cinque velocità fra 0,75× e 2×. |
| Nu Genea                       | Sciallà                                                                                                                                                            | Circa trenta secondi di progressione, aggiunta ai preferiti e artista seguito.                                                                                  |
| Khruangbin / Leon Bridges      | Texas Sun                                                                                                                                                          | Circa trenta secondi di progressione, aggiunta ai preferiti e artista seguito.                                                                                  |
| Daft Punk / Julian Casablancas | Instant Crush                                                                                                                                                      | Circa trenta secondi di progressione, aggiunta ai preferiti e artista seguito.                                                                                  |
| Ascolto infinito da Sciallà    | Tienaté; Marechià; Praja Magia                                                                                                                                     | Tre passaggi da UI alla proposta successiva, circa sei secondi per traccia, sorgenti diverse e segnale non nullo.                                               |
| Fine naturale nella radio      | Bar Mediterraneo                                                                                                                                                   | Seek vicino alla fine di Praja Magia, poi vero evento di fine e avanzamento automatico. Nuova sorgente AAC, clock e segnale verificati.                         |

Controlli aggiuntivi eseguiti sui brani reali:

- Pausa senza avanzamento del clock, ripresa con avanzamento effettivo.
- Reselezione di DISISA già ascoltata: avvio da zero.
- Seek verso la fine di DISISA e passaggio automatico a UNA SARPA: verificati
  sia il nuovo titolo sia il cambio effettivo di sorgente e il segnale audio.
- Dieci comandi rapidi avanti/indietro; la sorgente finale coincide con la
  traccia selezionata. Una sola istanza audio durante l'intera sessione.
- Metadati delle dodici tracce: Toni Zeno e copertina dell'album presenti.
  Le durate AAC osservate corrispondono a quelle del catalogo, entro gli
  arrotondamenti del provider; nessun raddoppio nelle tracce campionate.
- Creazione di una playlist contenente Praja Magia, ricarica della pagina,
  riapertura dalla libreria: contenuto e accesso persistono.

Le prime prove avevano rilevato blocchi reali; sono state conservate e non
contate come esiti positivi. La ripetizione dopo le correzioni completa le
sessioni sopra senza errori nativi registrati in Chromium.

## Problemi trovati e correzioni

### Le richieste di ispezione HLS avanzavano la radio

Il browser chiedeva gli ultimi segmenti delle tracce preparate per ispezionare
il margine della playlist live. Il server interpretava queste richieste come
ascolti, estendeva continuamente la radio e ritirava tracce ancora da ascoltare.
Nella prima prova il cursore era già oltre la coda dell'album mentre la prima
traccia era ancora in riproduzione.

La progressione della sessione viene ora aggiornata entrando nel primo segmento
di una traccia; una richiesta del segmento finale continua a essere servita,
senza essere contata come avanzamento. Una regressione automatica richiede
ripetutamente i segmenti finali e verifica che coda e cursore non avanzino.

### Supporto HLS dichiarato, ma sorgente live non utilizzabile

Nel Chromium disponibile su Windows la sorgente live lunga risultava senza
intervalli cercabili, con durata infinita. I cambi di traccia tramite seek
potevano bloccarsi. Nel confronto diagnostico il segnale della sorgente HLS
era nullo, mentre lo stesso brano dal proxy AAC aveva clock e segnale validi.

Il player verifica ora questa condizione su una traccia lunga dopo l'avvio.
Se persiste, passa al proxy AAC conservando posizione e lo stesso elemento
audio. Un seek in quella condizione attiva immediatamente il recupero.
Il recupero disabilita HLS per quella istanza del player: non viene riprovato
a ogni brano. Può comportare una ricarica della prima sorgente; non è una
promessa di riproduzione senza interruzioni su ogni motore.

La regressione automatica usa AAC reale generato da una fixture originale,
una playlist live lunga, seek e cambio brano; controlla anche il segnale.
I percorsi HLS con intervalli cercabili restano coperti dalle prove esistenti.

### Un artista escluso rientrava nelle collaborazioni

Dopo aver escluso Daft Punk, Get Lucky e altre collaborazioni continuavano
a comparire perché l'artista visualizzato conteneva più nomi. Anche Instant
Crush restava nelle scelte veloci.

Il contratto conserva ora i singoli crediti degli artisti. Filtri, profilo,
mix e scelte veloci li considerano separatamente. I brani salvati con il
vecchio formato mantengono un confronto compatibile sui crediti visualizzati.
I nomi dei gruppi contenenti virgole restano interi quando il provider fornisce
i crediti strutturati. La ripetizione reale non mostra più Daft Punk o le sue
collaborazioni nei consigli e nelle scelte veloci; i preferiti salvati restano
accessibili nella libreria.

### La ricerca di un artista privilegiava le ospitate

La ricerca Toni Zeno poteva mettere prima brani di altri autori in cui
compariva soltanto come ospite. Il ranking dà più peso all'artista principale,
mantenendo più forte la corrispondenza esatta con il titolo di una canzone.
Una regressione copre la ricerca osservata. Canali con lo stesso nome e ID
diversi non vengono uniti automaticamente.

## Qualità dei consigli osservata

Seguendo e ascoltando Nu Genea, sono comparsi Tienaté e altre sue tracce.
Dopo Texas Sun, fra le prime proposte sono entrati The Man Who Took My
Sunglasses ii e People Everywhere dei Khruangbin. Dopo Instant Crush sono
comparsi Something About Us e Give Life Back to Music dei Daft Punk.

La scelta esplicita di ascoltare più Nu Genea ha cambiato le motivazioni dei
consigli; chiedere meno Toni Zeno lo ha tolto dalle prime proposte. Il blocco
Daft Punk è stato verificato di nuovo dopo la correzione delle collaborazioni.

La radio da Sciallà ha aggiornato la proposta a ogni passaggio: Tienaté,
Marechià, Praja Magia e poi Bar Mediterraneo. Le alternative includevano anche
Khruangbin. Gli artisti da scoprire dopo Khruangbin includevano BADBADNOTGOOD,
Skinshape e Hermanos Gutiérrez; dopo Daft Punk, Gesaffelstein, Kavinsky e Modjo.

Questi risultati mostrano adattamento ai segnali e continuità rispetto agli
artisti ascoltati, non una valutazione universale del gusto musicale. La parte
più bassa del feed conserva proposte esplorative più generiche. Il servizio AI
locale era indisponibile: è stato esercitato il ripiego reale sugli artisti
correlati, senza attribuire questi risultati a un modello AI.

## Controlli automatici e limiti

- `pnpm check`: 332 test superati in 53 file; lint, tipi e build validi.
- `pnpm test:e2e`: 107 scenari superati, 7 HLS esclusi su Windows WebKit.
- Stress controllato separato: dodici sorgenti originali per motore, cinque
  velocità, venti comandi rapidi e tre eventi di fine. Le metriche di avvio
  verificano sorgente e avanzamento nativo; l'evento `playing` resta una misura
  opzionale perché WebKit può accorparlo durante un cambio di sorgente.

**Prova reale non superata su Windows WebKit:** l'app e le richieste fetch
autenticate funzionano, ma la richiesta audio nativa riceve 401. La stessa
sessione ottiene 206 con un fetch Range. Impostare esplicitamente le credenziali
sull'elemento audio non risolve il problema. Non è stata allentata
l'autenticazione per aggirarlo. La causa e l'eventuale riproducibilità su iOS
restano da verificare: i risultati Chromium non certificano Safari su iPhone.

Le sessioni usano HTTP locale con viewport iPhone. Non verificano fisicamente
CarPlay, blocco dello schermo, interruzioni telefoniche o PWA installata. Una
prova aprendo un'altra scheda non ha reso il documento nascosto: non viene
contata come prova in background. I tempi locali, con cache in parte già
popolata, non sono un benchmark dell'avvio a freddo su rete mobile.

Le evidenze locali sono in `artifacts/real-listener/`, ignorate da Git:
`album-session.json`, `discovery-session.json`, `infinite-real-session.json`,
`infinite-natural-ended.json`, `blocked-artist-after-fix.json`,
`persistence-session.json`, `webkit-real-session.json`,
`webkit-credentials-probe.json`, `e2e-verified.log` e acquisizioni delle schermate.
Le prime prove fallite e il confronto HLS/AAC sono conservati nella stessa
cartella. Il database contiene soltanto gli account usa e getta di questo audit.
