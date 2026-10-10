# Registro prove fisiche

**NON ESEGUITO:** nessun iPhone/CarPlay fisico usato nell’implementazione locale.

| Area                              | Esito        | Evidenza |
| --------------------------------- | ------------ | -------- |
| Safari iPhone foreground          | Non eseguito | —        |
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
