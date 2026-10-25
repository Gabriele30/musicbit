# Audit mobile con Playwright — 24 ottobre 2026

L’audit usa l’app compilata, Chromium e WebKit con profilo mobile e controlli touch. Non richiede BrowserStack né l’iPhone personale. Il catalogo deterministico di prova comprende 24 brani, sei artisti, sei album, una libreria già popolata, due playlist con titoli lunghi, preferiti, cronologia e statistiche annuali. Account, sessioni e salvataggio della libreria usano l’API isolata reale; catalogo, immagini, radio e statistiche sono risposte controllate. Le raccomandazioni della fixture chiamano la funzione condivisa effettiva sulla libreria salvata.

## Difetti riprodotti e correzioni

- Home: con una libreria popolata le scelte veloci erano sotto mix e raccolte. Ora precedono gli strumenti personali e i mix; senza ascolti non si aggiunge una sezione vuota.
- Strumenti personali: la prima scheda occupava tutta la larghezza senza suggerire la presenza delle altre. Ora si vede il bordo della successiva. Le descrizioni lunghe occupano al massimo due righe.
- Playlist: le immagini non erano vincolate correttamente alla larghezza della scheda e avevano dimensioni diverse. La copertina condivisa ora resta quadrata, contenuta e uniforme; gestisce anche l’immagine mancante. Il fallback delle copertine nasconde effettivamente l’immagine fallita, senza essere sovrascritto dal CSS.
- Coda: intestazioni e spiegazioni duplicate occupavano quasi tutto il primo schermo. Ora rimangono un titolo, il conteggio e il controllo dell’ascolto infinito. Le azioni di riordino/rimozione sono nel menu del brano, lasciando spazio al titolo. Aprendola a metà album, il viewport raggiunge automaticamente il brano corrente e quelli a seguire; i brani precedenti restano accessibili scorrendo verso l’alto.
- Player in orizzontale: i comandi finivano sotto lo schermo. Il layout compatto dispone copertina e controlli affiancati.
- Taste Profile: il collegamento dalla Home apriva il generico profilo account. Ora porta direttamente al titolo delle preferenze e vi sposta il focus.
- Ricerca: i suggerimenti sparivano quando arrivava la risposta remota. Restano disponibili durante la scrittura, con un’azione esplicita per mostrare tutti i risultati. La posizione del campo e l’altezza della lista si adattano al viewport visibile, anche quando l’avviso di ripresa da un altro dispositivo occupa spazio.
- Personalizzazione: differenze di maiuscole o spazi nei nomi degli artisti aggiravano deduplicazione, limite di ripetizione e preferenze. Le raccomandazioni, i mix e le scelte veloci confrontano nomi normalizzati.
- Avvio: l’interfaccia ospite poteva ricevere una ricerca prima che arrivasse la sessione account; il successivo cambio di spazio la azzerava. Ora i controlli diventano disponibili dopo la risoluzione della sessione e il collegamento della persistenza. Una prova trattiene esplicitamente la risposta dell’account per verificare questa sequenza.

## Verifiche

- `pnpm check`: lint, tipi, 315 test in 51 file e build di produzione.
- `pnpm test:e2e --workers=4`: 101 scenari superati, 5 esclusi perché il decoder HLS nativo non è disponibile nel WebKit distribuito per Windows.
- Nuovi scenari permanenti in `tests/e2e/mobile-usability.spec.ts`: Home popolata, focus delle preferenze, copertine uniformi, leggibilità della coda a 320 px, rimozione dal menu, comandi in orizzontale, suggerimenti dopo la risposta remota e spazio ridotto a 450 px di altezza.
- Test di regressione dell’algoritmo: varianti del nome non aggirano il limite di due brani per artista, la deduplicazione o il blocco esplicito; le scelte veloci rispettano lo stesso blocco.
- Confronto visivo di ricerca, album, player, coda, preferiti, playlist, menu, rinomina, Taste Profile e Wrapped.
- Home e Wrapped controllati a 320, 375, 390 e 430 px; player anche a 844 × 390. Nessun overflow orizzontale nelle schermate acquisite; un solo elemento audio durante la navigazione.

Le acquisizioni e le misure della sessione locale sono in `artifacts/mobile-audit/` (directory ignorata da Git). La suite mantiene tracce dei fallimenti in `test-results/` e produce il rapporto Playwright.

## Limiti della verifica

WebKit su Windows non riproduce iOS, la PWA installata, la sospensione a telefono bloccato o CarPlay. Questi risultati verificano interfaccia e flussi nei browser di prova; non certificano tali comportamenti fisici. Il catalogo controllato evita inoltre che un blocco del provider trasformi un test dell’interfaccia in un errore di rete. L’accesso a nuovi stream reali rimane una verifica separata; questo intervento non modifica il trasporto audio.
