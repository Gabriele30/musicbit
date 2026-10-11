# MusicBit: qualità del prodotto e direzione del redesign

Analisi del 11 ottobre 2026. Affianca [l'audit tecnico](product-audit.md).

## Stato del lavoro

Il primo intervento è implementato: Home compatta, navigazione Home/Cerca/Libreria,
player dal mini-player, coda nella barra del player, menu condiviso, pagine
artista/album e copertine con fallback. La navigazione conserva scroll, ricerca,
filtro della libreria e l'elemento audio. Demo e informazioni tecniche sono
separate dai percorsi normali; le demo del player richiedono `?screen=player&demo=1`.

Il secondo intervento aggiunge risultati misti con filtri, query recenti eliminabili,
menu playlist, rinomina su richiesta, modalità modifica con trascinamento/frecce,
rimozione annullabile e riproduzione da un indice mantenendo la coda completa.
Restano URL dei dettagli, paginazione della ricerca, backup e sincronizzazione.

Le parti rimanenti delle fasi 2–4 e i criteri di ricerca con persone/dispositivi fisici restano da
completare. Le voci seguenti descrivono la direzione complessiva, non una parità
già raggiunta con Spotify o YouTube Music.

Screenshot aggiornati: [Home](assets/home.png),
[artista](assets/artist.png), [player](assets/player.png), [desktop](assets/desktop.png).

## Valutazione

MusicBit ha un nucleo funzionante: catalogo, feed, pagine artista/album, playlist,
preferiti, cronologia, coda e autoplay. Il salto successivo riguarda la qualità
dei percorsi quotidiani, la personalizzazione e la continuità tra dispositivi.
I test automatici esistenti verificano il comportamento; non dimostrano da soli
una buona usabilità o equivalenza ai servizi commerciali.

La direzione grafica proposta mantiene il verde lime come firma del marchio,
con superfici scure neutre e copertine protagoniste. Ogni schermata deve mettere
in evidenza il contenuto e una sola azione principale.

## Criticità osservate prima del redesign

| Area            | Evidenza attuale                                                                                                              | Intervento proposto                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Home mobile     | Logo, intestazioni, badge PWA e banner occupano quasi tutta la prima schermata; le prime copertine arrivano vicino al fondo   | Intestazione compatta, accessi recenti e musica subito visibili; banner editoriale solo quando utile                   |
| Navigazione     | Cinque destinazioni mobili: Home, Cerca, Libreria, Player, Coda                                                               | Tre destinazioni principali; player dal mini-player, coda dal player; diagnostica nelle impostazioni                   |
| Artista e album | Dettaglio generico, azioni grandi e metadati ripetuti prima della musica                                                      | Pagine specifiche: immagine, nome, informazioni pertinenti, Play principale, Segui/Salva e menu secondario             |
| Playlist        | Modulo di rinomina sempre aperto, pulsanti a tutta larghezza e tre controlli per riga                                         | Menu contestuale, modalità modifica, riordino tramite trascinamento con alternativa accessibile, rimozione annullabile |
| Ricerca         | Una categoria per volta, risultati limitati, assenza di cronologia delle ricerche e paginazione                               | Risultati iniziali misti con corrispondenza principale, filtri, query recenti e caricamento progressivo                |
| Coerenza        | Una card della Home può riprodurre, mentre una riga della ricerca apre dettagli; alcune etichette del feed restano in inglese | Regole coerenti per card, righe, pulsante Play e menu; terminologia italiana uniforme                                  |
| Continuità      | Dettagli e filtri dipendono in parte da stato locale delle schermate                                                          | URL navigabili per artista/album/playlist; Indietro ripristina ricerca, filtri e posizione di scorrimento              |
| Libreria        | Salvataggio nel browser, nessun backup o sincronizzazione                                                                     | Export/import iniziale, poi archivio persistente e sincronizzazione opzionale con gestione dei conflitti               |

La tabella conserva la diagnosi iniziale. Il primo intervento risolve la
gerarchia della Home e delle pagine musicali, la navigazione principale e la
conservazione del contesto tra sezioni. Ricerca avanzata, modifica delle playlist,
URL dei dettagli e sincronizzazione restano nelle fasi successive.

## 1. Fondamenta visive e navigazione

- Definire variabili condivise per colori, tipografia, spaziatura, raggi,
  elevazione e animazioni. Consolidare le regole CSS duplicate durante il redesign.
- Creare componenti coerenti: riga brano, card album, card artista, azioni,
  menu, finestra mobile dal basso, avviso annullabile e stati di caricamento.
- Semplificare l'intestazione e spostare informazioni tecniche nelle impostazioni.
  Mostrare avvisi di connessione quando richiedono un'azione dell'utente.
- Home: accessi rapidi agli ascolti e alle playlist, riprendi ascolto, suggerimenti
  pertinenti e nuove uscite. Copertine reali con fallback curati e dimensioni stabili.
- Mobile: Home / Cerca / Libreria, mini-player persistente, player a schermo intero
  e coda raggiungibile dal player. Desktop: barra laterale e player inferiore,
  usando lo spazio per mostrare più musica.
- Ripristinare ricerca, scroll e contesto dopo chiusura del player e navigazione.

Criterio di completamento: su schermo mobile da 390 × 844 CSS px si vedono
contenuti musicali azionabili prima di scorrere; mini-player e navigazione non
coprono righe o comandi. Navigare non ricrea l'elemento audio né interrompe il brano.

## 2. Percorsi di ascolto e gestione della musica

- Ricerca: risultati misti, suggerimenti e ricerche recenti cancellabili,
  paginazione, azione Play riconoscibile e navigazione artista/album immediata.
- Artista: immagine importante, brani popolari, discografia, nuove uscite e simili.
  Album: copertina, anno se disponibile, elenco ordinato e informazioni verificate.
- Playlist: ricerca interna, ordinamento, copertina modificabile, riordino,
  operazioni multiple, menu contestuale e Annulla dopo le rimozioni.
- Conservare la playlist di destinazione entrando in Cerca da “Aggiungi musica”.
- Player: copertina, titolo e artista leggibili, avanzamento facile da toccare,
  salvataggio rapido, repeat/shuffle comprensibili, timer di spegnimento.
- Coda: distinguere “Riproduci dopo” da “Aggiungi in fondo”; mostrare separatamente
  la selezione dell'utente e i suggerimenti automatici. Rendere recuperabili gli errori.
- Libreria: filtri e ordinamento persistenti, elementi fissati, vista lista/griglia,
  gestione semplice di raccolte grandi e limite di spazio spiegato prima di perdere dati.

Criterio di completamento: test con 5–8 persone su ricerca e riproduzione,
salvataggio in playlist, modifica della coda e ripresa dell'ascolto. Obiettivo
iniziale: almeno il 90% dei compiti completato senza aiuto. Registrare tempi,
tocchi e punti di esitazione; correggere i problemi osservati.

## 3. Personalizzazione, dati e affidabilità

- Il feed del provider e la cronologia locale sono il punto di partenza.
  Aggiungere un ordinamento proprio basato su preferiti, artisti seguiti,
  ascolti completati, salti e feedback esplicito “Meno come questo”.
- Mix personali e radio con controllo sulla quantità di novità, ripetizioni
  recenti e varietà degli artisti. Spiegare in modo breve perché appare un consiglio.
- Raffinare il catalogo: duplicati, versioni live/remix/cover, relazioni
  brano–album–artista e immagini. Mostrare solo metadati effettivamente disponibili.
- Backup recuperabile della libreria; successivamente account e sincronizzazione
  tra dispositivi con migrazione dei dati locali e conflitti prevedibili.
- Misurare avvio audio e disponibilità su più tracce e reti. Obiettivi iniziali,
  ancora da dimostrare: p95 click→playing sotto 2 s a freddo e 700 ms a caldo,
  con almeno 30 campioni per condizione e misura separata del tempo al suono.
- Provare fisicamente Safari e PWA iPhone: almeno 30 minuti, schermo bloccato,
  controlli esterni, chiamate, cambio rete e recupero. Conservare la protezione
  mirata contro durata raddoppiata e coda silenziosa.
- Prima di un servizio pubblico: controllo accessi e traffico, isolamento del
  codice del provider e monitoraggio degli errori con dati minimi.

Gli obiettivi prestazionali e di usabilità sopra indicati sono criteri proposti,
non risultati già ottenuti.

## 4. Funzioni avanzate e integrazioni

Download offline gestiti dall'utente, testi sincronizzati, normalizzazione volume,
transizioni tra brani, condivisione e playlist collaborative, controllo remoto
dei dispositivi e integrazioni auto sono progetti distinti. Per ciascuno servono
fonte dati, architettura, comportamento in errore e test su dispositivo.

Gapless/crossfade e capacità di sistema richiedono una verifica specifica:
l'architettura attuale mantiene un solo HTMLAudioElement e la PWA ha vincoli
diversi dalle applicazioni native. Non considerarli semplici interruttori grafici.

## Accessibilità e qualità trasversale

- Obiettivo WCAG 2.2 AA: contrasto, focus visibile, tastiera, etichette per lettori
  di schermo e stato dei controlli annunciato correttamente.
- Aree di tocco di progetto da 44–48 CSS px per i controlli principali. È una
  scelta di usabilità: il minimo WCAG 2.2 AA per il criterio 2.5.8 è 24 × 24 CSS px,
  con eccezioni e condizioni di spaziatura.
- Testo normale con contrasto almeno 4,5:1 e testo grande almeno 3:1 secondo
  le definizioni WCAG; verificare anche icone e controlli.
- Animazioni brevi, rispettose di reduced-motion; feedback immediato al tocco,
  caricamenti stabili, stati vuoti utili ed errori con una prossima azione chiara.
- Eseguire `pnpm check` e `pnpm test:e2e` per ogni intervento a playback/PWA.
  Aggiungere verifiche pertinenti ai nuovi percorsi e controlli visivi sulle
  schermate chiave. Affiancare i test automatici a prove umane e su telefoni reali.

## Primo intervento consigliato

Un primo gruppo di modifiche completo e verificabile comprende: sistema visivo,
Home compatta, navigazione a tre sezioni, mini-player e player coerenti,
menu contestuale condiviso e pagine artista/album. La fase successiva completa
ricerca, playlist e libreria; personalizzazione e sincronizzazione seguono
con criteri propri. La qualità si valuta su compiti e misure, oltre che sulle immagini.

## Riferimenti di prodotto e standard

- [Spotify, aggiornamenti a organizzazione libreria, playlist e coda, 28 maggio 2026](https://newsroom.spotify.com/2026-05-28/playlist-folders-mobile-queue-controls-updates/).
- [YouTube Music, scoperta e controllo delle raccomandazioni](https://support.google.com/youtubemusic/answer/13401025?hl=it).
- [W3C, dimensioni minime degli obiettivi di interazione](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- [W3C, contrasto minimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
