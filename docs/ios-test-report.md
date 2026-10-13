# Registro prove fisiche

## Flusso unico HLS — nuova segnalazione del 13 ottobre 2026

L'utente conferma che il cambio silenzioso a schermo bloccato persiste dopo v4,
anche senza skip rapidi. I precedenti interventi non hanno quindi risolto il
caso fisico. La revisione `native-continuous-hls-v5` introduce un percorso diverso:
una sorgente HLS nativa per la coda, con segmenti AAC remuxati sul server e
discontinuità fra brani. Il passaggio automatico non cambia src e non richiama
play. Il server prepara anche la radio a partire dalle richieste native dei
segmenti. Vedi [architettura e limiti](continuous-playback.md).

La verifica locale usa AAC reale, FFmpeg, manifesti con più brani e la stessa
sorgente nel player con posizioni relative e skip/seek. L'uscita sonora su
iPhone fisico e CarPlay resta da confermare: il nuovo percorso deve comparire
come **HLS continuo nativo** nella diagnostica della stessa installazione.

Controlli locali completati: `pnpm check` con 267 test e `pnpm test:e2e` con
84 prove. Il test backend include AAC reale e l'estensione autonoma della radio
da richieste di segmenti, senza un nuovo comando della pagina. I test desktop
del percorso progressivo restano distinti dalla verifica HLS su iPhone.

## Skip rapidi da CarPlay — 13 ottobre 2026

L'utente precisa che il difetto si ripresenta premendo rapidamente skip dai
comandi al volante, con iPhone collegato tramite CarPlay. La preparazione del
solo successore non copre tutti i brani attraversati da questi comandi.

La revisione `native-session-handoff-v4-skip` interrompe il tentativo nativo ancora
in caricamento prima di cambiare nuovamente sorgente, poi chiama play nello stesso
handler Media Session. Conserva un solo elemento e non aggiunge load al cambio.
Ignora eventi riferiti a currentSrc precedente, pause tardive quando il nodo non
è in pausa ed errori senza un MediaError attuale. I token continuano a scartare
le promesse dei comandi superati.

Oltre al prefetch completo dell'immediato successore, prepara prefissi HTTP da
64 KiB degli altri candidati nella finestra dei prossimi dieci, al massimo due
richieste contemporanee. I piani server da 5 GB restano separati. I prefissi non
sono brani completi né una garanzia di avvio in background; la preparazione
fallita non controlla la riproduzione. La conferma fisica di skip rapidi CarPlay
con telefono bloccato resta da raccogliere dopo il deploy.

Verifica automatica: `pnpm check` superato con 264 test e `pnpm test:e2e` con
84 prove. La prova di skip consecutivi usa la superficie Media Session nativa
in Chromium e una simulazione dei comandi in WebKit Windows, che non espone
quell'API. In entrambi i casi l'elemento HTMLAudioElement e la decodifica WAV
sono reali; non sono una prova del percorso CarPlay fisico.

## Nuova segnalazione del 13 ottobre 2026 — cambio silenzioso

L'utente riferisce nuovamente il passaggio al brano successivo con tempo in
avanzamento sulla schermata di blocco, senza audio. Allo sblocco il brano parte
da zero. La precedente conferma non valida quindi la build con cache su disco.

La revisione `native-session-handoff-v3-prime` rimuove la disattivazione del
prefetch del prossimo brano nel browser introdotta dalla cache per account.
Restano i dieci download sul server, mentre una sola sorgente successiva viene
preparata anche attraverso il telefono. È una regressione individuata nel codice
e una possibile spiegazione della ricomparsa; manca la conferma causale fisica.
Il player conserva il nodo audio, la chiamata sincrona a play e la categoria
playback. Gli eventi di metadati/caricamento non ripubblicano la posizione Media
Session fino all'avanzamento effettivo di currentTime dopo playing; la diagnostica registra anche la risoluzione della
promessa play senza interpretarla come prova di suono. La verifica su iPhone
bloccato dopo l'aggiornamento resta da raccogliere.

Un precedente [bug WebKit sul cambio sorgente in background](https://bugs.webkit.org/show_bug.cgi?id=229688)
descrive una classe di difetti simile; non dimostra un bug nella versione iOS
attuale né che questa modifica risolva la segnalazione.

## Segnalazione del 12 ottobre 2026 — coda a schermo bloccato

L'utente riferisce avvii lenti sul server Tailscale e mancato passaggio automatico
a brani mai ascoltati quando l'iPhone è bloccato. Le precedenti conferme non
validano questo scenario.

La correzione prepara in memoria il prossimo brano durante la riproduzione,
mantiene un solo elemento audio e anticipa la risoluzione del primo risultato
di ricerca. I test coprono il cambio con pagina nascosta, i limiti/cancellazioni
del prefetch e il passaggio nativo a un brano preparato dopo aver disabilitato
il provider a monte. WebKit desktop non riproduce la sospensione reale di iOS:
**la conferma su iPhone bloccato resta da raccogliere dopo il deploy**.

### Seconda segnalazione — sessione silenziosa al cambio brano

L'utente conferma il difetto sia in Safari sia dalla Home, con iOS **26.6.2**
(versione riferita). Dopo il primo brano la schermata di blocco avanza il tempo,
ma non si sente audio; tornando in MusicBit il secondo brano è a zero e parte.
Il prefetch precedente **non ha risolto la prova fisica**.

La revisione `native-session-handoff-v2` dichiara `audioSession.type = playback`
quando supportato, solo dopo un comando di ascolto. Il passaggio fra sorgenti
mantiene il nodo nativo, imposta `preload=auto` e chiama `play()` subito dopo
`src`, senza un ulteriore `load()`. Il contatore Media Session viene cancellato
al cambio e dichiarato in pausa finché non arriva `playing`; anche `waiting`
ferma l'estrapolazione. La diagnostica esporta categoria/stato audio, paused,
ended e identificativo della revisione, senza dedurre l'udibilità dal contatore.

È disponibile un comando esplicito **Aggiorna MusicBit** quando il service worker
segnala una versione in attesa. Il comando ricarica soltanto al tocco dell'utente.
I test nativi WebKit/Chromium verificano il cambio senza `load()` aggiuntivo;
non dimostrano la corretta uscita audio con iPhone fisicamente bloccato.
**Esito fisico di questa revisione: da verificare**.

Riferimenti di progetto: [Audio Session](https://w3c.github.io/audio-session/),
[precedente WebKit con play risolto e nessun suono in background](https://bugs.webkit.org/show_bug.cgi?id=173332#c23).
Il precedente orienta l'indagine e non prova una regressione nella versione iOS
riferita dall'utente.

### Diagnostica ricevuta alle 21:42 del 12 ottobre (Europe/Rome)

Il JSON fornito dall'utente non contiene `playbackRevision`, categoria audio,
`paused` o `ended` negli eventi: proviene da una build precedente alla revisione
`native-session-handoff-v2`. Il server era già aggiornato. Lo snapshot è inoltre
`idle`, a zero, con `attempts: []` e tre demo SoundHelix; non contiene il passaggio
brano segnalato. Il collegamento diretto alla diagnostica ha aperto una finestra
diversa dalla sessione di ascolto. Non è un esito fisico della nuova revisione.

È stata rimossa l'inizializzazione automatica dei demo nella diagnostica ordinaria
(rimangono disponibili con `demo=1`). Un export senza tentativi è disabilitato e
spiega come aprire la diagnostica dalla sessione corrente. La pagina di recupero
`/api/app-update` passa fuori dalle regole di navigazione dei vecchi worker e
attiva esplicitamente l'aggiornamento, senza cancellare cookie o storage.
Gli E2E riproducono un vecchio worker ancora attivo, il recupero e la conservazione
di cookie e coda; non sostituiscono la prova fisica del passaggio audio su iPhone.

### Conferma successiva dell'utente e primo avvio

Dopo il recupero dell'aggiornamento l'utente riferisce **«Ora funziona»** per il
cambio a schermo bloccato. Conferma riferita, senza JSON della nuova prova,
durata o conferma separata Safari/Home. Rimane un'attesa percepita soprattutto
al primo brano. La preparazione dei metadati, già presente nella ricerca,
viene estesa a Home, album/artista, libreria/playlist e brano salvato nel player.
Una sola candidatura per schermata attiva, attesa breve di 250 ms, cancellazione
al cambio schermata/candidato e limite di 50 secondi. Nessun caricamento nativo
o download completo del brano viene avviato da questa preparazione.
Non è stata misurata una nuova latenza al suono sul dispositivo fisico.

### Cache persistente e ricerca — richiesta successiva del 12 ottobre

La preparazione dei metadati ora può avviare anche il download completo sul
server per l'account autenticato. Il nuovo piano prepara corrente, dieci
successivi e due precedenti; il telefono invia soltanto gli identificativi.
La cache su disco conserva le correzioni AAC ed è limitata a 5 GB per account,
con pulizia LRU e massimo due download concorrenti. Vedi
[politica della cache](server-audio-cache.md). Gli E2E verificano che un account
invii il piano senza scaricare il prossimo audio attraverso il browser.

La ricerca distingue righe brani e schede artista/album, ordina le corrispondenze
e gestisce i suggerimenti con tastiera e tocco. La verifica a 320 px ha individuato
e corretto anche il comportamento nativo di Escape che cancellava la ricerca in
Chromium invece di chiudere soltanto i suggerimenti. Nessuna nuova misura fisica
del primo suono o del passaggio a schermo bloccato è disponibile per questa build.

Verifica server delle 22:27 (Europe/Rome), codice `a9862b3`: 11 brani e
33.751.389 byte conservati dopo il riavvio dell'API, quota 5.000.000.000 byte.
Tre richieste Range interne da disco completate in 17–33 ms dopo il riavvio.
La richiesta HTTPS Tailscale dal server stesso, con TLS verificato, restituisce
206, 1.024 byte e `X-MusicBit-Audio-Storage: disk` in 100 ms complessivi.
Il brano di controllo mantiene durata 188 secondi. Sono misure HTTP sul server,
non latenza al suono su iPhone. Il controllo ha anche individuato trasferimenti
integrali senza Range a circa 32 KB/s: usando un Range completo, otto ulteriori
brani sono stati preparati in circa 30 secondi. Validazione automatica finale:
`pnpm check` (261 test) e `pnpm test:e2e` (82 test Chromium/WebKit) superati.

## Conferme dell’utente per M2

All’avvio di M3 l’utente ha riferito prove reali sul proprio iPhone con esito
positivo per riproduzione in primo piano, schermo bloccato, cambio automatico
del brano e PWA installata. Evidenza: dichiarazione nel messaggio di richiesta M3.
Non sono stati forniti modello, versione iOS, data/durata della prova, rete,
video/JSON o misure al suono. Queste conferme sono registrate come **riferite
dall’utente**, senza estenderle a comandi/interruzioni/scenari non descritti.
L’utente ha esplicitamente indicato CarPlay come non ancora testato.

| Area M2                         | Esito riferito      | Limiti dell’evidenza                                                    |
| ------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Riproduzione in primo piano     | Funzionante, utente | Modalità Safari/Home non specificata per questa singola prova           |
| Riproduzione a schermo bloccato | Funzionante, utente | Durata e comandi non specificati                                        |
| Cambio automatico brano         | Funzionante, utente | Non specificata separatamente la condizione di blocco durante il cambio |
| PWA installata                  | Funzionante, utente | iOS e dettagli della sessione non forniti                               |
| CarPlay                         | Non testato         | Confermato dall’utente                                                  |

## Regressione fisica M3

**NON ESEGUITA dall’agente:** nessun dispositivo fisico disponibile durante
l’implementazione M3. Le conferme M2 non validano automaticamente questa build.

| Area                              | Esito        | Evidenza |
| --------------------------------- | ------------ | -------- |
| Safari iPhone foreground M3       | Non eseguito | —        |
| PWA Home installazione/foreground | Non eseguito | —        |
| Schermo bloccato ≥5 minuti        | Non eseguito | —        |
| Comandi lock screen               | Non eseguito | —        |
| Cambio automatico bloccato        | Non eseguito | —        |
| Interruzioni/recupero             | Non eseguito | —        |
| CarPlay cablato                   | Non eseguito | —        |
| CarPlay wireless                  | Non eseguito | —        |
| Preload/preparazione iOS          | Non eseguito | —        |
| Target 0,5–1,5 s al suono iPhone  | Non eseguito | —        |
| HLS nativo / blocco schermo       | Non eseguito | —        |

## Validazione fisica M4

**NON ESEGUITA dall'agente.** Nessun iPhone fisico disponibile durante M4;
le conferme M2 non validano il laboratorio né la build corrente.

| Area M4                              | Esito        | Evidenza |
| ------------------------------------ | ------------ | -------- |
| Safari ricerca → sorgente → Play     | Non eseguito | —        |
| Preparazione e soglia al suono       | Non eseguito | —        |
| Lab dalla Home                       | Non eseguito | —        |
| Schermo bloccato / cambio automatico | Non eseguito | —        |
| Media Session / interruzioni         | Non eseguito | —        |
| CarPlay cablato / wireless           | Non eseguito | —        |
| Regressione principale M3/M4         | Non eseguito | —        |

Ambiente predisposto e verificato **dal PC**:
`https://192.168.1.100:4453/__playback/`, CA/SAN, manifest separato senza SW,
layout mobile e audio remoto autorizzato. Vedi
[evidenza desktop](performance/m4-https-smoke.json) e
[procedura M4](playback-ios-checklist.md). Non è prova di fiducia/raggiungibilità iPhone.

### Scheda da duplicare

- Data/ora e fuso:
- Commit/branch e URL HTTPS:
- iPhone/versione iOS:
- Modalità Safari oppure Home standalone:
- Rete/risparmio energetico:
- Auto/head unit/software/cablato-wireless:
- Passi e durata dell’osservazione:
- Risultato atteso/osservato:
- Esito superato/fallito/parziale/non disponibile (motivare):
- Cinque avvii a freddo, mediana e massimo:
- Definizione di freddo, cache/connessione e preparazione/ripresa:
- Preparazione prima del click, API, waiting, dati/playing:
- Primo suono: metodo di osservazione, tempi e latenza di reazione:
- Numero tentativi totali/falliti, soglia e rete per cui si valuta il target:
- Snapshot Media Session e lifecycle prima/dopo il cambio in background:
- JSON/video/screenshot associati:
- Limiti/regressioni/azione successiva:

## Ambiente predisposto M2 (non è una prova fisica)

HTTPS LAN verificato dal PC su `https://192.168.1.100:4443`, con CA/SAN,
API/manifest/SW. CA non installata automaticamente. Tailscale Serve richiede
abilitazione esterna e non è attivo. I 12 E2E includono WebKit emulato Windows;
il pulsante “Suono udito” è premuto sinteticamente solo per testare la telemetria.
Benchmark e HLS sono prove desktop/server, non evidenze delle righe sopra.

# Registro M5 — 10 ottobre 2026

Nessun test fisico M5 eseguito dall'agente. Non estendere le conferme dell'utente
su M2 a YouTube. HTTPS lab M5 verificato dal PC con CA/SAN sull'IP LAN
192.168.1.100:4463, UI mobile/manifest/un audio, nessun SW o iframe automatico.
Il controllo ufficiale ha raggiunto playing in Chromium foreground; il provider
stream nativo è rimasto disabilitato senza permessi diretti documentati.
Safari/PWA su iPhone, schermo bloccato, next e CarPlay M5: **non testati**.
[Checklist da compilare](youtube-playback-ios-checklist.md),
[evidenza HTTPS PC](performance/m5-https-smoke.json).
