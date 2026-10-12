# Registro prove fisiche

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
