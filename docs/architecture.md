# Architettura M1 + M2

```text
Safari / PWA → stessa origine /api/tracks → Fastify → MusicProvider
          └→ HTMLAudioElement → sorgente MP3 HTTPS autorizzata
          └→ Media Session → controlli offerti dal sistema operativo
```

Vite fa da proxy in dev/preview, Nginx nei container; Caddy aggiunge TLS.
Il media viene riprodotto direttamente, senza Web Audio o crossOrigin anonymous:
nessun CORS richiesto per il semplice elemento audio.

`main.tsx` crea e appende un solo audio prima di montare React. `PlayerEngine`
conserva elemento, listener, coda e diagnostica; `useSyncExternalStore` legge
snapshot immutabili. Navigare non smonta audio. Teardown riservato a test e HMR.
Play/next/previous chiamano subito `play()` senza await; un contatore invalida le
promise precedenti dopo nuovi comandi/pausa/errori. Il passaggio automatico usa
`ended`, senza timer JS: l’esecuzione a pagina sospesa va provata su iPhone.

Stati: idle, loading, playing, paused, ended, error. `waiting` indica buffering;
`stalled` si registra perché può risolversi. Un errore non salta automaticamente
le tracce; si può riprovare o cambiare sorgente. Nessun autoplay al caricamento.

M2 estende l’engine esistente: preparazione opt-in dell’attuale src nello stesso
audio, stato separato della preparazione e consumo senza nuovo load; annullamento
e timeout rilasciano la sorgente nativa. Deadline 15 s, ripulita per ogni nuovo
comando, sospesa/deferita a pagina hidden; non arresta audio nativo avanzato
quando gli eventi JS tardano. Nessun secondo audio per precaricare la successiva.
Pausa mantiene il buffer per conservare il comportamento M1.

`catalog.ts` isola timeout API 10 s e cancellazione con AbortController, registra
header/corpo/validazione. `Server-Timing` misura solo il provider Fastify.
Gli URL del provider demo sono diretti: nessuna seconda risoluzione stream.
Resource Timing opzionale rispetta TAO; diagnostica espone intervalli buffered,
waiting, errori, lifecycle con traccia/posizione e osservazione umana del suono.
Log limitati, niente keepalive/polling in background. `/?screen=diagnostics`
apre direttamente la vista mobile senza ricreare audio.

Shared definisce Track, risposte, validazione runtime e MusicProvider con id,
listTracks/getTrack. Le sorgenti richiedono HTTPS oppure un percorso relativo
alla stessa origine; artista, fonte, permesso e attribuzione sono obbligatori.
Il provider demo restituisce copie dei dati. La factory Fastify accetta provider
iniettati; testata anche sostituzione e fallimento.

Vite PWA genera manifest e SW Workbox per il solo app shell/grafiche; niente cache
runtime di API/media né handler Range. API/health e laboratorio /\_\_hls esclusi dal fallback HTML.
Gli aggiornamenti attendono la chiusura dei client; SW disattivato in dev.

`scripts/https-test.mjs` aggiunge TLS solo all’ambiente di test con CA locale
non installata automaticamente; /\_\_hls inoltra il laboratorio separato a 4180.
Il laboratorio usa un encoder live di toni originali, non MusicProvider né URL
MP3 remoti. Non modifica build Docker o dipendenze runtime delle app.

Rimandati login, persistenza, libreria privata, ricerca, raccomandazioni, HLS nel
player e YouTube. Prima di evolvere il trasporto servono prove fisiche: WebKit su Windows
non replica processi, sospensione, Bluetooth o CarPlay di iOS.
