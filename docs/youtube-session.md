# Collegare una sessione YouTube del server

Il 25 ottobre 2026 il server ha restituito `LOGIN_REQUIRED` con il motivo
“Sign in to confirm you’re not a bot” sia da YouTube Music sia dal client generale,
per Davide e NEON. Cambiare formato audio o riusare la cache non rimuove quel
requisito di accesso. Il collegamento deve essere effettuato personalmente
dall'operatore con un account che è autorizzato a usare.

## Collegamento interattivo

Il server deve avere la build che include `provider-session.js`,
`compose.youtube-session.yaml` nel progetto e `scripts/verify-youtube-session.mjs`
copiato nella home come `musicbit-youtube-verify.mjs`.

Dal PC del progetto, dopo `pnpm build`:

```powershell
pnpm youtube:connect --ssh operator@your-server
```

Si aprono la pagina locale MusicBit e la pagina Estensioni nel browser normale,
senza debug remoto, Playwright o profili controllati. La precedente finestra
controllata era stata rifiutata da Google come browser non sicuro. Non vengono
disabilitati controlli Google o modificati gli identificativi del browser.

1. In `chrome://extensions` attivare **Modalità sviluppatore**, scegliere
   **Carica estensione non pacchettizzata** e selezionare la cartella
   `tools/youtube-session-extension` del progetto. La pagina MusicBit permette
   di copiare il percorso completo.
2. Nei dettagli dell'estensione abilitare **Consenti modalità incognito**.
   Se era già installata, premere **Ricarica** per usare la versione 1.0.2.
3. Aprire una finestra in incognito dedicata con Ctrl+Maiusc+N e accedere
   personalmente a YouTube. Da quella finestra aprire **MusicBit · collega
   YouTube** e premere **Esporta per il mio server**.
4. Chiudere tutte le finestre in incognito **senza effettuare il logout da
   YouTube**. Nel browser normale selezionare il file nella pagina MusicBit
   locale e premere **Collega al server**.

La [documentazione YouTube.js](https://ytjs.dev/guide/authentication) raccomanda
questa esportazione da una finestra privata poi chiusa per evitare la rotazione
dei cookie. Un'esportazione dal Chrome abituale era risultata inizialmente
funzionante ma non più autenticata al successivo controllo: account restituiti
zero e pagina YouTube con `LOGGED_IN: false`. La causa precisa della revoca non
è provata; la nuova procedura evita di continuare a usare la sessione esportata
nel browser. Non garantisce che Google non la revochi successivamente.

L'estensione richiede solo il permesso cookie su `https://*.youtube.com/*`,
necessario per leggere anche i cookie del dominio principale `.youtube.com`.
Non ha script nelle pagine, controllo del browser o accesso agli altri siti.
Esporta soltanto i cookie di autenticazione YouTube non scaduti; non effettua
richieste verso server esterni. Dopo l'importazione eliminare il file esportato
e rimuovere l'estensione se non serve più.

La versione 1.0.1 corregge il permesso della prima versione. Se l'estensione
è già caricata, premere **Ricarica** nella sua scheda in `chrome://extensions`
e controllare che abbia accesso a YouTube. La regressione
`pnpm youtube:test-extension` carica la vera estensione in Chromium isolato e
verifica il download tramite l'API cookie reale con soli dati fittizi.

Soltanto il pulsante **Collega al server** autorizza il trasferimento del file
selezionato. Il connettore non legge password o profili del browser.
La sessione viene inviata tramite SSH al server già autorizzato, in
`~/.config/musicbit/youtube.cookies`: directory privata, file con permessi 600,
sostituzione atomica. Nessun valore di cookie viene scritto nei log, negli
argomenti dei processi, nel repository o nell'immagine Docker.

Il connettore ricrea soltanto il servizio API con il file montato in sola
lettura: una riproduzione in corso può interrompersi durante quel riavvio.
Database e cache persistenti restano nei loro volumi. I browser degli utenti
MusicBit non ricevono la sessione YouTube. Il provider isolato ha accesso al
solo file configurato, senza ottenere l'ambiente API o l'archivio degli account.

Prima di sostituire il file precedente, un container temporaneo verifica la
sessione candidata: Google deve restituire almeno un account autenticato, senza
registrarne nome o identità. Solo dopo il controllo e l'audio di entrambi i brani
il file viene attivato. Una candidata rifiutata non sostituisce la sessione attiva.

Il collegamento mostra successo **solo se l'account è riconosciuto ed entrambi i brani di verifica si
risolvono e restituiscono byte audio dal server**, attraverso il vero processo
provider isolato. Non basta che esista un cookie. Se YouTube continua a
richiedere accesso/verifica, la pagina segnala il mancato sblocco e permette
di riprovare; non dichiara il problema risolto.

La pagina locale scade dopo trenta minuti. La sessione sul server rimane fino
alla sua scadenza o revoca. Se Google impedisce l'accesso anche nel normale
browser, il programma non aggira la verifica: il collegamento rimane incompleto.

## Configurazione manuale per altri ambienti

`YOUTUBE_COOKIE_FILE` indica un file assoluto privato. Sono supportati un header
cookie su una riga e il formato Netscape. I cookie di domini diversi da YouTube,
scaduti o relativi ad altri percorsi vengono ignorati; è richiesto `SAPISID`.
Il file è limitato a 64 KiB e, su Linux, non deve essere leggibile dal gruppo
o da altri utenti. Deve essere leggibile dall'UID del servizio API.

Esempio Docker, quando il file privato è già stato fornito dall'operatore:

```sh
MUSICBIT_YOUTUBE_SESSION_FILE="$HOME/.config/musicbit/youtube.cookies" \
docker compose -f compose.yaml -f compose.local-ai.yaml \
  -f compose.youtube-session.yaml up -d --no-build --no-deps --force-recreate api
```

Non inserire il contenuto del file in `.env` o in variabili `VITE_`. Non inviarlo
in chat, issue o report. I cookie autenticati vengono usati solo per metadati
YouTube, senza redirect; non vengono inviati agli host dei file audio.

Per ricollegare una sessione scaduta si ripete il connettore. Per scollegare,
ricreare API senza l'override `compose.youtube-session.yaml`, poi eliminare il
solo file di sessione e revocare la relativa sessione dall'account Google.

Questa configurazione non garantisce che ogni traccia sia disponibile:
restrizioni regionali, contenuti privati o ulteriori verifiche del fornitore
restano possibili. Non cambia i diritti di accesso dell'account collegato.
