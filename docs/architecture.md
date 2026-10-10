# Architettura M1

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

Shared definisce Track, risposte, validazione runtime e MusicProvider con id,
listTracks/getTrack. Le sorgenti richiedono HTTPS oppure un percorso relativo
alla stessa origine; artista, fonte, permesso e attribuzione sono obbligatori.
Il provider demo restituisce copie dei dati. La factory Fastify accetta provider
iniettati; testata anche sostituzione e fallimento.

Vite PWA genera manifest e SW Workbox per il solo app shell/grafiche; niente cache
runtime di API/media né handler Range. API/health esclusi dal fallback HTML.
Gli aggiornamenti attendono la chiusura dei client; SW disattivato in dev.

Rimandati login, persistenza, libreria privata, ricerca, raccomandazioni, HLS e
YouTube. Prima di evolvere il trasporto servono prove fisiche: WebKit su Windows
non replica processi, sospensione, Bluetooth o CarPlay di iOS.
