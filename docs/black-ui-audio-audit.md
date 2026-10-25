# Interfaccia Black, consigli e stabilità audio

Verifica locale del 24 ottobre 2026. Le modifiche sono nel progetto locale; questa sessione non pubblica su GitHub e non distribuisce sul server.

Per la successiva prova con **19 canzoni reali**, le ulteriori correzioni e i risultati aggiornati, vedere [real-listening-audit.md](real-listening-audit.md). I conteggi sotto descrivono la verifica precedente con fixture controllate.

## Interfaccia e copertine

- Fondo nero, superfici neutre e contrasto più leggibile in Home, ricerca, album, libreria, player, Wrapped, playlist AI e classifica. Il verde rimane un accento per le azioni e gli stati selezionati.
- Colore della PWA e del documento aggiornato a nero, inclusa la pagina di recupero dell’app.
- Sei scelte veloci, copertine quadrate e titoli su due righe. I consigli personali precedono i mix automatici. I nomi lunghi delle playlist non allungano indefinitamente le schede.
- Copertina condivisa anche nei suggerimenti della coda. Le immagini del provider Google vengono richieste a risoluzione adatta alle schede; in caso di errore si prova l’originale, quindi il segnaposto. Cambiando brano si può caricare nuovamente una copertina valida.
- Il catalogo preferisce copertine quadrate alle miniature video panoramiche quando il provider offre entrambe.
- Controllo di velocità nel player: 0,75×, 1×, 1,25×, 1,5×, 2×. Il cambio non crea un altro elemento audio né ricarica la sorgente. La velocità vale per la sessione corrente e torna a 1× cambiando account.

## Consigli musicali

- Le proposte alternano gli artisti quando esistono alternative e mantengono un limite di due brani per artista.
- La deduplicazione considera titolo e artista normalizzati, oltre agli identificativi. Questo evita copie della stessa canzone fra proposte, ascolti recenti e coda progressiva. Anche un brano rifiutato non rientra con un altro ID quando entrambe le versioni sono presenti fra i candidati.
- I pesi dei conteggi storici sono limitati; le scelte esplicite “più”, “meno” ed “escludi” prevalgono sul profilo dedotto.
- Le tracce di partenza per radio e consigli cambiano con ascolti recenti, preferiti e skip. Si scelgono artisti diversi, escludendo i brani ignorati e quelli troppo penalizzati dagli skip.
- La Home aggiorna le richieste anche quando cambiano segnali e brani esclusi dal profilo.
- Il mix “In loop” ordina tutti i candidati prima di limitarli a trenta: un brano molto ascoltato non scompare perché si trovava oltre il trentesimo preferito.
- Un errore del feed generale non elimina i consigli già ottenuti dalle radio personali. Le due sorgenti vengono interrogate in parallelo.

## Prove automatiche

`pnpm check` verifica lint, tipi, test e compilazione. `pnpm test:e2e --workers=4` esegue la suite completa su Chromium e WebKit mobili.

La prova di stress usa dodici file PCM originali con frequenze e durate diverse, serviti via HTTP con Range al vero HTMLAudioElement. Per ciascuno verifica durata, avanzamento del clock, velocità selezionata, assenza di errori e tempo fino all’evento nativo `playing`. Seguono venti comandi rapidi avanti/indietro, un’ulteriore selezione, il riavvio da zero di un brano già ascoltato e tre cambi automatici generati da veri eventi `ended`. La stessa istanza audio deve sopravvivere all’intera sequenza.

Una prova separata usa AAC/HLS: modifica la velocità, esegue seek e skip rapidi e controlla che sorgente e istanza audio restino le stesse. Le altre prove HLS coprono discontinuità, ripresa, coda estesa e sospensione del JavaScript.

Le statistiche misurano il tempo reale di ascolto anche a velocità diversa da 1×. Un seek in corso di conferma usa la velocità effettiva per distinguere avanzamento normale e salti, evitando una correzione all’indietro ingiustificata.

Le prove UI controllano il tema del documento e del manifest, quattro larghezze di telefono, copertine quadrate, assenza di overflow e applicazione effettiva dei feedback dalla schermata Taste Profile alla Home.

Dati grezzi dello stress: `artifacts/black-audio/chromium-mobile.json` e `artifacts/black-audio/webkit-mobile.json`. Schermate: `artifacts/mobile-audit/black-final-*`. Questi artefatti locali sono ignorati da Git.

## Limiti

I dati del catalogo nelle prove sono controllati; i dodici file audio sono toni di prova originali, non dodici canzoni commerciali. I tempi misurano il comando Playwright fino all’evento `playing` sulla macchina locale: non sono una misura dell’uscita acustica, del servizio esterno o della rete dell’iPhone. Windows WebKit non certifica CarPlay, PWA installata e audio a telefono bloccato. I sei scenari HLS sono esclusi su quel motore per indisponibilità del decoder nativo; vengono invece eseguiti nel Chromium disponibile nell’ambiente.

## Esito conclusivo

- `pnpm check`: superato; 328 test in 53 file, tipi, lint e build validi.
- `pnpm test:e2e --workers=4`: 106 scenari superati, sei HLS esclusi su Windows WebKit.
- Quattro larghezze mobile e orientamento orizzontale verificati tramite acquisizioni Playwright; nessun overflow nelle viste acquisite.
- Dodici sorgenti progressive per ciascun motore, cinque velocità, venti comandi rapidi avanti/indietro e tre cambi automatici: zero errori nativi registrati.

| Motore          | Sorgenti | Mediana comando → playing | Massimo | Errori nativi |
| --------------- | -------: | ------------------------: | ------: | ------------: |
| Chromium mobile |       12 |                     85 ms |  206 ms |             0 |
| WebKit mobile   |       12 |                    336 ms |  415 ms |             0 |

Il primo avvio e i successivi cambi usano sorgenti locali con il normale prefetch dell’app. I tempi non sono un benchmark del catalogo remoto. Il riepilogo grezzo è in `artifacts/black-audio/summary.json`.
