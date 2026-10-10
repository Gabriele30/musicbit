# Checklist iPhone / CarPlay

**Prove fisiche tutte da eseguire.** Registrare esiti/evidenze in
`ios-test-report.md` e allegare il JSON diagnostico dopo ogni sessione. Eseguire
CarPlay ad auto ferma oppure con un passeggero che gestisca i controlli.

## Preparazione e foreground

- [ ] Annotare data, commit, iPhone, versione iOS, modalità Safari/Home, rete,
      risparmio energetico, accessori e modello/software dell’unità CarPlay.
- [ ] HTTPS senza avvisi TLS, health/catalogo disponibili, icona Home e safe area corrette.
- [ ] Ripetere ogni scenario in Safari e nella PWA installata.
- [ ] Primo tocco udibile; raccogliere cinque avvii a freddo, mediana e massimo.
      Definire la soglia di avvio rapido per questa rete, senza presumere un risultato.
- [ ] Pausa/riprendi, seek avanti/indietro e precedente prima/dopo 3 secondi.
- [ ] Successivo e tocchi rapidi senza doppio audio o errori tardivi.
- [ ] Aggiungere duplicati, spostare/rimuovere upcoming e attendere ended.
- [ ] Player → Coda → Diagnostica senza interruzione audio.
- [ ] Disconnettere rete durante caricamento/ascolto: buffer, errore e Riprova.

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
