# Checklist iPhone / CarPlay

**M2: quattro esiti positivi riferiti dall’utente; M3 e CarPlay da verificare.**
Vedi i limiti della dichiarazione nel registro. Registrare nuovi esiti/evidenze in
`ios-test-report.md` e allegare il JSON diagnostico dopo ogni sessione. Eseguire
CarPlay ad auto ferma oppure con un passeggero che gestisca i controlli.

## Regressione catalogo M3 (Safari e PWA Home separatamente)

- [ ] Chiudere tutti i client della vecchia build e riaprire; badge M3, HTTPS
      attendibile. Non forzare un aggiornamento durante un ascolto da preservare.
- [ ] Avviare una demo, aprire Cerca, cercare brani/artisti/album: niente doppio
      audio o interruzione, una sola demo e posizione crescente in Diagnostica.
- [ ] Tastiera ricerca senza zoom inatteso, filtri e risultati leggibili in
      portrait/landscape, nessuno scroll orizzontale; provare nomi lunghi/Unicode.
- [ ] Tocchi rapidi e correzione query: solo ultimo risultato; attendere rete lenta,
      annullare/cambiare schermata e verificare assenza di errori tardivi.
- [ ] Dettagli brano, artista, album e tracklist, ritorno alla ricerca; miniature
      mancanti non devono impedire navigazione. Tutto marcato solo catalogo,
      nessun Play/accodamento YouTube, link sorgente esplicito.
- [ ] Media Session/lock screen continuano a mostrare la demo effettivamente in
      ascolto, non il brano di catalogo aperto. Bloccare da Cerca, ascoltare e
      verificare cambio automatico, poi sbloccare e tornare al Player.
- [ ] Ricerca vuota/errore provider/offline: messaggio e Riprova senza cambiare
      sorgente audio; non promettere risultati o media offline.
- [ ] Ripetere la checklist player sotto, registrando regressioni rispetto a M2.
      CarPlay va eseguito come nuova prova, senza dedurlo dai risultati lock screen.

## Preparazione e foreground

- [ ] Annotare data, commit, iPhone, versione iOS, modalità Safari/Home, rete,
      risparmio energetico, accessori e modello/software dell’unità CarPlay.
- [ ] HTTPS senza avvisi TLS, health/catalogo disponibili, icona Home e safe area corrette.
- [ ] Seguire [ios-https.md](ios-https.md); annotare CA locale/Tailscale/dominio,
      origine e percorso esatto. Aprire `/?screen=diagnostics` per i controlli.
- [ ] Ripetere ogni scenario in Safari e nella PWA installata.
- [ ] Primo tocco udibile; raccogliere cinque avvii a freddo, mediana e massimo.
      Definire la soglia di avvio rapido per questa rete, senza presumere un risultato.
- [ ] Separare cinque avvii **senza preparazione**, cinque con **Prepara traccia**
      fino a dati pronti e cinque riprese. Definire “freddo”: nuova scheda/sessione,
      buffer, cache HTTP e stato rete. Non chiamare “freddo” solo un nuovo tap.
- [ ] Annotare API, preparazione, click→playing, waiting, readyState/networkState,
      intervalli esposti ed errori. Segnare TTFB “non disponibile” se TAO lo nasconde.
- [ ] In foreground, premere “Suono udito” appena percepito; annotare latenza di
      reazione e acquisire anche prova esterna del click/primo suono quando possibile.
      In background/CarPlay usare osservatore/registrazione esterna e orari, non
      sbloccare per premere il pulsante durante la prova.
- [ ] Target per la rete annotata: 0,5–1,5 s al suono con sorgente preparata.
      Registrare anche tutti i tentativi falliti e il costo prima del click.
- [ ] Verificare se preload è rispettato da Safari e Home. Provare Annulla prima
      e dopo canplay: nessun autoplay, riprova valida. Considerare il traffico MP3.
- [ ] Pausa/riprendi, seek avanti/indietro e precedente prima/dopo 3 secondi.
- [ ] Successivo e tocchi rapidi senza doppio audio o errori tardivi.
- [ ] Aggiungere duplicati, spostare/rimuovere upcoming e attendere ended.
- [ ] Player → Coda → Diagnostica senza interruzione audio.
- [ ] Disconnettere rete durante caricamento/ascolto: buffer, errore e Riprova.
- [ ] Foreground: sorgente/API che non risponde, rispettivi timeout ~15/~10 s;
      next/pausa durante l’attesa non devono applicare errori di comandi superati.

## Schermo bloccato e background

- [ ] Avviare con un gesto, bloccare lo schermo, ascoltare per almeno 5 minuti.
- [ ] Lock screen / Centro di Controllo: titolo, artista e copertina corretti.
- [ ] Play/pausa/next/previous dal sistema con schermo bloccato.
- [ ] Seek agli ultimi 10 secondi, bloccare prima della fine, verificare passaggio
      automatico; ripetere con PWA in background da almeno 5 minuti.
- [ ] Ripetere lasciando terminare una traccia intera con schermo bloccato.
- [ ] Aprire altra app e tornare: stato, posizione e coda coerenti.
- [ ] Chiamata/Siri, cuffie collegate/scollegate, risparmio energetico e cambio
      Wi-Fi/cellulare: registrare interruzioni e recupero.
- [ ] Ultima traccia termina senza loop o richieste impreviste.
- [ ] Esportare JSON dopo sblocco e allegare video/osservazione con orari. Eventi
      JS assenti durante sospensione non provano audio continuo o interrotto.
- [ ] Cercare visibility/pagehide/pageshow/freeze/resume, posizione e traccia
      attorno al passaggio. Verificare che il ritorno non interrompa audio già
      avanzato a causa di un timer JS tardivo; nessuna deadline real-time garantita.

## CarPlay: funzioni eventualmente offerte da iOS

- [ ] Annotare cablato/wireless, auto/head unit e versione software.
- [ ] Collegare, avviare MusicBit sul telefono e aprire “In riproduzione”.
- [ ] Audio reale dagli speaker, titolo, artista e copertina corretti.
- [ ] Comandi head unit/volante play/pausa/next/previous, anche a telefono bloccato:
      riportare quali azioni sono effettivamente esposte e funzionanti.
- [ ] Fine traccia e successiva senza sbloccare il telefono.
- [ ] Navigazione vocale/interruzioni e recupero dell’audio.
- [ ] Disconnessione/riconnessione CarPlay: recupero o gesto richiesto.
- [ ] Ripetere Safari/Home e cablato/wireless separatamente, se disponibili.
- [ ] “In riproduzione” non disponibile: registrare limite/fallimento. M1 non
      promette un’icona o un catalogo CarPlay nativo.

## Offline e aggiornamento

- [ ] Dopo visita online, offline + reload mostra UI/copertine e avviso catalogo,
      senza promettere audio scaricato; online + Riprova catalogo recupera.
- [ ] Deploy nuova build durante playback: nessun reload forzato, aggiornamento
      alla successiva chiusura/riapertura di tutti i client.

## Laboratorio HLS separato

- [ ] Avviare `pnpm experiment:hls` e aprire `https://<IP-LAN>:4443/__hls/`.
      Portare HLS_DURATION a 600 nella shell per una prova ≥5 minuti; default 300 s.
- [ ] Annotare supporto HLS nativo e tempo iniziale; osservare almeno tre cambi
      tono senza nuovo src, in Safari e Home, poi con schermo bloccato.
- [ ] Esportare JSON HLS separato e confrontare MP3 preparato sulla stessa rete.
      I toni non provano transizioni arbitrarie tra file musicali o Media Session HLS.
- [ ] Annotare interruzioni, segmenti scaduti, comportamento live alla ripresa,
      CarPlay, consumi e CPU server. Non migrare il player sulla sola prova PTS.
