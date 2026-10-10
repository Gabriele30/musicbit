# Registro prove fisiche

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

## Scheda da duplicare per sessione

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

HTTPS LAN verificato dal PC su `https://192.168.1.69:4443`, con CA/SAN,
API/manifest/SW. CA non installata automaticamente. Tailscale Serve richiede
abilitazione esterna e non è attivo. I 12 E2E includono WebKit emulato Windows;
il pulsante “Suono udito” è premuto sinteticamente solo per testare la telemetria.
Benchmark e HLS sono prove desktop/server, non evidenze delle righe sopra.
