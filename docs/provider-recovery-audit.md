# Ripristino dei brani non in cache

25 ottobre 2026. Su Davide (`DF04hTcoH3s`) e NEON (`UtMAolKOLM8`), le richieste
reali effettuate dal server, con client musicale e generale, restituiscono
`LOGIN_REQUIRED`: “Sign in to confirm you’re not a bot”, senza formati audio.
Non è un difetto del decoder AAC o una durata errata.

È stato predisposto il [collegamento autorizzato](youtube-session.md):

- File di sessione privato, montato in sola lettura, con accesso limitato al
  processo provider. Valori di cookie assenti da ambiente, IPC e risposte API.
- Invio delle credenziali soltanto ai metadati YouTube, senza redirect e senza
  trasmissione agli host dei file audio.
- Finestra browser dedicata e accesso Google manuale. Trasferimento al server
  soltanto dopo il pulsante esplicito dell'operatore nella pagina locale.
- Successo subordinato a risoluzione dei due brani e ricezione di byte audio
  reali attraverso il provider isolato del container configurato.

Verifiche locali: `pnpm check`, **352 test in 55 file**, tipi, lint e build
superati; `pnpm test:e2e`, **109 scenari superati**, 7 HLS esclusi su Windows
WebKit. Coperti parsing, domini, scadenza, file esplicito, isolamento, redirect,
assenza di credenziali nei descrittori audio e preferenza AAC-LC.

Sul server è pronta l'immagine `musicbit-api:youtube-session-20261025` con smoke
test isolato dalla rete superato. La versione precedente è conservata come
`musicbit-api:before-youtube-session-20261025`. La preparazione non riavvia il
container in uso: l'attivazione della sessione ricrea soltanto API dopo il
pulsante dell'operatore. Database e cache rimangono nei volumi esistenti.

La prima finestra controllata è stata rifiutata da Google come browser/app non
sicuro. Il connettore è stato quindi sostituito con l'importazione esplicita
dal browser normale: l'estensione locale esporta solo su clic i cookie YouTube,
senza automazione, script sulle pagine o accesso ad altri siti. Il file viene
selezionato personalmente nella pagina locale prima del trasferimento SSH.

Il collegamento è stato completato personalmente dall'operatore. Una nuova
verifica indipendente, con un processo provider fresco nel container API,
conferma entrambi i brani:

| Brano  | ID          | Risposta media     | Formato   | Durata risolta |
| ------ | ----------- | ------------------ | --------- | -------------- |
| Davide | DF04hTcoH3s | 206, byte ricevuti | audio/mp4 | 206 s          |
| NEON   | UtMAolKOLM8 | 206, byte ricevuti | audio/mp4 | 207 s          |

Il container API risulta `healthy`. Il precedente requisito di accesso è quindi
superato per entrambi i brani realmente verificati; non è una garanzia su ogni
contenuto o su eventuali restrizioni future del fornitore. I test non hanno
esportato cookie o URL firmati nei report. Nessun accesso o push a GitHub.

Dopo la sostituzione della finestra controllata: `pnpm check` supera **355 test
in 56 file**. Una prova UI Playwright separata verifica pulsante, download e
compatibilità del file dell'estensione con soli cookie fittizi, senza richieste
a Google né credenziali reali. Evidenze: `normal-browser-check.log` ed
`extension-ui-test.json` nella stessa cartella degli artefatti.

Correzione successiva, estensione 1.0.1: il permesso limitato a
`www.youtube.com` non consentiva all'API cookie reale di leggere i cookie
`.youtube.com`. Il test iniziale via HTTP con API simulata non esercitava
questo vincolo. Il permesso ora copre soltanto `*.youtube.com` e il pulsante
mostra subito uno stato di lettura. `pnpm youtube:test-extension` carica la vera
estensione Chromium, scarica e valida un file con cookie fittizi e verifica il
caso senza sessione. Regressione superata; `pnpm check`: 355 test in 56 file.
Le estensioni già caricate richiedono **Ricarica** per applicare il manifest.

Evidenze locali ignorate da Git: `artifacts/provider-recovery/check-final.log`,
`e2e.log` e script diagnostico `compare-clients.mjs`. Questi ultimi non stampano
cookie o URL firmati.

Aggiornamento del 25 ottobre: una prova di ascolto più lunga ha riprodotto il
rifiuto `LOGIN_REQUIRED` anche per Davide e NEON, con file di sessione ancora
configurato e processi provider nuovi. I precedenti due successi non dimostrano
quindi una soluzione duratura. L'audio in cache continua a funzionare; l'accesso
affidabile a brani nuovi rimane aperto. Vedere `deep-account-audit.md` per la
distinzione fra stabilità del player e disponibilità del fornitore.
