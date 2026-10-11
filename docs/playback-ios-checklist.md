# M4 · Procedura fisica iPhone

**Da eseguire.** I test desktop Chromium/WebKit non validano questi passi.
Duplicare la scheda nel [registro](ios-test-report.md), allegando gli export JSON.
Le conferme M2 dell'utente rimangono separate.

1. PC e iPhone sulla stessa rete privata. Con i certificati M2 presenti,
   `pnpm build`, poi PowerShell: `$env:PLAYBACK_LAB_HTTPS='true'` e
   `pnpm experiment:playback`. Aprire `https://<IP-LAN>:4453/__playback/`.
   Fiducia CA, firewall (TCP **4453**) e SAN: [istruzioni HTTPS](ios-https.md).
   Il lab riusa i certificati senza installare fiducia. Se cambia l'IP, rigenerare
   il leaf con `pnpm test:https`, conservando la CA; riavviare i server HTTPS.
2. Registrare modello, iOS, data, branch, URL, rete e risparmio energetico.
   Esportare la diagnostica iniziale. Ripetere separatamente in Safari e dalla
   Home: Condividi → Aggiungi alla schermata Home. Verificare standalone.
   Il lab ha manifest proprio, senza SW/offline; non aggiorna l'icona MusicBit M3.
3. Cercare SoundHelix, selezionare Song 1. Verificare disponibilità e attribuzione;
   prima di Play non deve partire audio. Misurare cinque avvii diretti. Definire
   lo stato cache: una nuova scheda non azzera server/connessioni/DNS; consultare
   miss/hit nel JSON.
4. Mettere in pausa, Prepara audio, attendere ready, Play. Ripetere cinque volte
   registrando **sia** preparazione **sia** click→playing. Provare Play durante
   preparazione e Annulla preparazione. Annotare preload ignorato/consumo dati.
   Non equiparare playing al primo suono: registrare metodo e ritardo umano.
5. Durante Song 1: Risolvi prossima demo. Verificare assenza di interruzioni;
   Riproduci prossima deve avviare Song 2 sullo stesso elemento. La risoluzione
   non precarica byte audio. Confrontare eventi/buffer/latenza.
6. Risolvere la prossima, bloccare il telefono almeno cinque minuti fino alla
   fine naturale del brano, verificare cambio automatico. Ripetere senza
   descrittore: la fine deve fermarsi. Nessun timer/rinnovo asincrono garantisce
   un cambio quando JS è sospeso.
7. Provare play/pausa/next dai controlli di sistema quando offerti; verificare
   titolo/artista al cambio. Registrare le azioni effettivamente mostrate da iOS,
   senza dedurle dalla sola presenza di Media Session API.
8. Provare ritorno dalla Home, cambio rete, breve assenza di rete, interruzione
   audio e riconnessione Bluetooth. Annotare errore e recupero via risoluzione/Play.
   Per URL scaduti/timeout server usare i test deterministici: le demo non scadono.
9. Cercare un risultato YouTube, selezionarlo: `NO_AUTHORIZED_SOURCE`, Play
   disabilitato, nessuna nuova sorgente. Se suona una demo deve continuare.
10. A veicolo fermo ripetere playback/cambio/pausa in CarPlay cablato e wireless
    se disponibili. Verificare l'integrazione “In riproduzione”, non un'app CarPlay
    nativa. Annotare auto, head unit e versioni.
11. Sbloccare, esportare JSON senza reload, associare eventi hidden/visible alle
    osservazioni. Eventi JS ritardati non provano interruzioni audio. Registrazione
    esterna utile; screen recording può alterare il comportamento al blocco.
12. Ripetere la [checklist principale](ios-checklist.md) sulla PWA porta 4443 per
    la regressione. Il lab non viene promosso automaticamente nel principale.
