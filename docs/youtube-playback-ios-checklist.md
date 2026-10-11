# M5 · Procedura iPhone e registro da compilare

**Non eseguita su iPhone fisico.** Le conferme M2 non coprono gli stream YouTube.
CarPlay resta non testato. Non annotare PASS usando solamente Chromium/WebKit
desktop, `canPlayType`, lo stato iframe o l'avvenuta risoluzione di un URL.

## Avvio HTTPS

1. PC e iPhone sulla stessa Wi-Fi. Dalla radice `pnpm install --frozen-lockfile`,
   `pnpm build`. Non servono `pnpm start` o modifiche al player principale.
2. Riutilizzare CA/certificato M2 in `artifacts/https`. Se assenti o scaduti,
   seguire [ios-https.md](ios-https.md); non trasferire chiavi private.
3. PowerShell: `$env:YOUTUBE_PLAYBACK_LAB_HTTPS='true'`, poi
   `pnpm experiment:youtube`. Su Debian: `YOUTUBE_PLAYBACK_LAB_HTTPS=true pnpm experiment:youtube`.
4. Aprire l'URL stampato; su questo PC `https://192.168.1.100:4463/__youtube/`.
   Certificato attendibile senza avvisi; verificare `/__youtube/health`.
   Se Windows richiede accesso alla rete, usare la rete privata di test e porta
   TCP 4463. L'agente non ha modificato firewall o fiducia del dispositivo.
5. `pnpm smoke:youtube:https` controlla dal PC TLS/CA/SAN, UI mobile, manifest,
   un audio, nessun SW/iframe automatico e blocco della sorgente non autorizzata.
   Non dimostra che l'iPhone raggiunga o si fidi del server.
6. Safari → Condividi → Aggiungi alla schermata Home. Usare l'icona **YouTube Lab**
   separata dalla PWA principale. Il lab non offre offline; mantenere il server attivo.

Ctrl+C arresta il lab. `Remove-Item Env:YOUTUBE_PLAYBACK_LAB_HTTPS` ripristina il
default HTTP loopback `http://127.0.0.1:4183/__youtube/` nella shell PowerShell.

## Percorso disponibile senza permessi diretti

- Cercare Carefree / Kevin MacLeod, selezionare il risultato, risolvere.
  Atteso: `DISABLED` (oppure `NO_AUTHORIZED_SOURCE` se abilitato senza permessi);
  Play nativo disabilitato, nessun URL audio. Un blocco atteso non è un PASS playback.
- Caricare esplicitamente il player ufficiale visibile, poi premere Play.
  Registrare stato, errore, tempi ed esito udibile. Controllo esclusivamente
  foreground; quando nascosto il laboratorio lo mette in pausa intenzionalmente.
- Cambiare il risultato selezionato e ripetere il controllo foreground soltanto
  per contenuti autorizzati. Non nascondere/ridurre/aggirare il player ufficiale
  per cercare playback a schermo bloccato. Nessuna deduzione sul player nativo.

## Abilitazione del percorso nativo, solo con permessi reali

Inserire in `artifacts/youtube-playback-permissions.json` un array di record con:

```json
[
  {
    "videoId": "VIDEO_ID_11",
    "title": "Titolo autorizzato",
    "artist": "Titolare",
    "contentPermissionUrl": "https://example.invalid/content-permission",
    "servicePermissionUrl": "https://example.invalid/direct-platform-permission",
    "attribution": "Attribuzione richiesta dal titolare",
    "expiresAt": "2026-12-31T23:59:59.000Z"
  }
]
```

**Esempio strutturale con segnaposto, non un'autorizzazione.** Il titolare del
contenuto e il servizio devono consentire l'uso previsto, inclusi accesso diretto,
audio/background, secondo i documenti applicabili. La verifica è a cura
dell'operatore; il software valida solo struttura e data. Non inserire cookie,
token, headers, password o URL firmati: i record accettano solo i campi mostrati,
con riferimenti HTTPS senza credenziali/query. Massimo 20 video ID esatti univoci.

Impostare nella shell (o `.env` locale):

```powershell
$env:YOUTUBE_PLAYBACK_LAB_ENABLED = 'true'
$env:YOUTUBE_PLAYBACK_PERMISSIONS_FILE = 'artifacts/youtube-playback-permissions.json'
$env:YOUTUBE_PLAYBACK_LAB_HTTPS = 'true'
pnpm experiment:youtube
```

Riavviare dopo ogni modifica ai permessi. Default TTL 60000 ms, timeout 10000 ms,
configurabili con `YOUTUBE_PLAYBACK_TTL_MS` e `YOUTUBE_PLAYBACK_TIMEOUT_MS`.
Revocare un permesso fermando il lab, rimuovendo il record e riavviando; la cache
è solo in memoria. Il flag principale non abilita YouTube nel player M1.

## Sessione fisica nativa da eseguire dopo la risoluzione autorizzata

Registrare modello iPhone, versione iOS, Safari/PWA, rete, data/fuso, video ID,
permessi applicabili e export JSON prima/dopo ciascuna prova. Non condividere
URL media o credenziali. Eventi del browser non provano il primo suono fisico.

| Prova                          | Procedura                                                                                                              | Esito attuale |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| Foreground cold                | Riavviare lab/sessione; ricerca → selezione → risoluzione → Play; cronometrare anche il suono udibile                  | Non eseguita  |
| Warm                           | Ripetere risoluzione; annotare cache e validità, poi Play                                                              | Non eseguita  |
| Preparata                      | In pausa premere Prepara, attendere ready; annotare costo prima di Play                                                | Non eseguita  |
| Cambio manuale                 | Mentre suona A selezionare B e Risolvi come prossima; A deve continuare; poi Riproduci prossima                        | Non eseguita  |
| Cambio automatico              | Risolvere/stagiare B, attendere ended di A senza reload; annotare intervallo udibile                                   | Non eseguita  |
| Schermo bloccato               | Dopo Play bloccare per almeno 2 minuti, includere ended/cambio; provare controlli lockscreen                           | Non eseguita  |
| PWA installata                 | Ripetere foreground, preparazione e lockscreen dall'icona del lab                                                      | Non eseguita  |
| Background/ritorno             | Passare a un'altra app e ritornare; export eventi visibility/pagehide/pageshow, posizione e buffering                  | Non eseguita  |
| Interruzioni                   | Chiamata/Siri/cambio uscita audio; verificare pausa/ripresa da gesto                                                   | Non eseguita  |
| URL scaduto                    | Attendere validità senza tentare rinnovi/aggiramenti; verificare rifiuto SOURCE_EXPIRED e nuova risoluzione consentita | Non eseguita  |
| Errori 403/429/non disponibile | Registrare solo se osservati; nessun cambio client/IP, token o proxy; interrompere il test                             | Non eseguita  |
| CarPlay                        | Auto ferma: controlli/metadata/cambio; nessuna UI CarPlay nativa presunta per PWA                                      | Non eseguita  |

Usare Esporta JSON. Click→playing, tempi di preparazione, eventi buffer, errori,
Media Session, visibilità e stato standalone sono nel report. Annotare separatamente
il suono udibile e le lacune dovute alla sospensione JS. Se `/player` risolve
ma l'audio fallisce, non classificare il problema come frontend senza evidenza HTTP;
Safari potrebbe nascondere status e dettagli cross-origin. L'analisi tecnica e i
risultati desktop sono in [youtube-playback-feasibility.md](youtube-playback-feasibility.md).
