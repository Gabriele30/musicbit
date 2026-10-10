# Catalogo M3: contratti e API

`MusicProvider` conserva `id/listTracks/getTrack` e aggiunge la capacità opzionale
`catalog: CatalogProvider`. SoundHelix continua a implementare le sole tracce
autorizzate. `YouTubeCatalogProvider` implementa ricerca/dettagli e restituisce
zero tracce riproducibili. `CatalogService` riceve un `CatalogProvider` iniettato:
mock e futuri adapter non richiedono modifiche al player.

`Track` include URL audio, permesso e attribuzione. `CatalogItem` include provider,
kind, id, titolo, artista, miniatura, URL sorgente e, se disponibili, album/anno/durata.
Ha sempre `playback: { available: false, reason: 'catalog-only' }`, senza `audioUrl`.
`CatalogDetail` può aggiungere la tracklist dell’album. Shared esporta contratti e
validatori runtime, usati anche prima di mostrare JSON ricevuto dal frontend.

## Endpoint della stessa origine

| Metodo e percorso                                             | Input / risultato                                      |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| GET `/health`                                                 | Contratto M1 invariato                                 |
| GET `/api/tracks`                                             | Tre demo autorizzate, invariato                        |
| GET `/api/providers`                                          | Capacità e disponibilità osservata, senza probe remoto |
| GET `/api/search?q=Bach&type=track&limit=15&provider=youtube` | Ricerca normalizzata                                   |
| GET `/api/search/artists?q=Bach`                              | Alias ricerca `type=artist`                            |
| GET `/api/search/albums?q=Bach`                               | Alias ricerca `type=album`                             |
| GET `/api/catalog/youtube/track/:id`                          | Metadati brano                                         |
| GET `/api/catalog/youtube/artist/:id`                         | Identità e miniatura artista                           |
| GET `/api/catalog/youtube/album/:id`                          | Metadati album e fino a 100 brani                      |

Query `q`: 1–120 caratteri, almeno un carattere non spazio, senza controlli ASCII;
spazi esterni rimossi e interni consecutivi normalizzati. Il frontend richiede
almeno due caratteri e attende 350 ms. `type`: track (default), artist, album;
`limit`: intero 1–25, default 15; unico provider attualmente selezionabile youtube.
Parametri query sconosciuti rifiutati. ID brano: 11 caratteri URL-safe; artista:
UC + 22 caratteri; album: prefisso MPR, massimo 128 caratteri. Nessun URL fornito
dal client viene visitato dal backend.

```json
{
  "provider": "youtube",
  "type": "track",
  "items": [
    {
      "id": "abcdefghijk",
      "provider": "youtube",
      "kind": "track",
      "title": "Esempio",
      "artist": "Artista",
      "sourceUrl": "https://music.youtube.com/watch?v=abcdefghijk",
      "playback": { "available": false, "reason": "catalog-only" }
    }
  ],
  "timing": { "cache": "miss", "elapsedMs": 450 }
}
```

Dettagli: `{ item, timing }`. Gli header sono `Cache-Control: no-store`,
`Server-Timing: metadata;dur=...`, `X-MusicBit-Cache: hit|miss|shared`.
La cache applicativa del server è indipendente dalla cache HTTP/SW del browser.

Errori: `{ code, error }`, senza stack, query o payload remoto. 400 INVALID_INPUT,
404 NOT_FOUND, 429 BUSY, 503 UNAVAILABLE/DISABLED, 504 TIMEOUT; CANCELLED usa 499
solo se il socket consente ancora una risposta. Nessun retry automatico verso
YouTube: il frontend offre Riprova.

## Timeout, cache e disponibilità

Configurazione all’avvio dell’API, letta dalla `.env` root tramite gli script pnpm;
Compose inoltra esplicitamente le stesse tre variabili:

| Variabile                 | Default  | Limiti                                 |
| ------------------------- | -------- | -------------------------------------- |
| `YOUTUBE_CATALOG_ENABLED` | `true`   | `false` disabilita le chiamate         |
| `CATALOG_TTL_MS`          | `300000` | 0–86400000; zero disabilita lo storage |
| `CATALOG_TIMEOUT_MS`      | `10000`  | 100–60000 ms                           |

200 chiavi LRU, massimo 32 lavori distinti attivi. Ricerca e dettagli hanno chiavi
separate; tipo/limite/query normalizzata fanno parte della chiave. I dati sono
copiati all’ingresso/uscita, non persistiti su disco e scadono secondo TTL.
Fallimenti, cancellazioni e dettagli mancanti non vengono salvati.

Richieste identiche condividono una promise e una deadline, senza azzerarla per
nuovi subscriber. Ogni chiamante può annullare; soltanto l’ultimo abbandono o la
deadline interrompono l’upstream. La chiusura prematura della risposta HTTP
annulla il subscriber. Il fetch YouTube riceve il segnale tramite AsyncLocalStorage
per non confondere richieste parallele su una sessione condivisa. La deadline
fa anche race della promise, così un adapter che ignora AbortSignal non blocca l’API.
`app.close()` interrompe lavori attivi e svuota la cache.

Il frontend ha una deadline di 12 s, cancella ricerca superata/dettagli abbandonati
e scarta risposte tardive. Con una deadline server superiore a 12 s, il browser
interrompe comunque prima. Il debounce non introduce operazioni nel percorso Play.

Stati YouTube: unverified prima della prima chiamata, available dopo un risultato
remoto riuscito, degraded dopo timeout/errore remoto, disabled da configurazione.
Timestamp e codice dell’ultimo esito upstream sono esposti; cache hit non è una
nuova verifica del servizio. Nessun polling di disponibilità o rete in background.
La demo available indica dati configurati e autorizzati, non una verifica continua
della raggiungibilità del server MP3. Lo stato mostrato nella schermata Cerca
riflette anche l’esito dell’ultima richiesta del browser.

## Normalizzazione e limiti intenzionali

La versione runtime è bloccata a `youtubei.js@18.1.0`. `music.search` usa filtri
song/artist/album e normalizza le shelf senza dipendere dai loro titoli tradotti.
`music.getArtist/getAlbum` usano browse. I dettagli brano selezionano soltanto
l’ID richiesto da `getUpNext(id, false)`: niente automix, radio o suggerimenti
esposti. Non vengono chiamati `getInfo/getBasicInfo`, che accedono a `/player`.
Fetch consente soltanto HTTPS search/browse/next su host YouTube noti, senza
redirect; player JS, streaming, download e host media sono esclusi anche da un
test di guardia. Sessione locale anonima, nessun account/cookie fornito dall’utente.

Solo prima pagina, senza continuazioni, playlist, testi o biografie. Thumbnail
HTTPS limitate a ytimg.com, ggpht.com e googleusercontent.com, senza credenziali;
nessun proxy immagini. Un dato facoltativo mancante resta omesso. Nodi/ID
incompatibili sono scartati. Cambi al parser o al servizio possono quindi produrre
errori o risultati incompleti: verificare l’adapter prima di aggiornare la libreria.

Fastify registra metodo/percorso senza query, codici e request ID; i log della
libreria sono disattivati per evitare dump di risposte. Nginx usa access log
senza query/header/IP; gli error log di `/api/` sono soppressi perché possono
includere l’URI originale. Stato HTTP resta nell’access log, cause applicative
nei codici Fastify. Proxy esterni aggiunti al deployment vanno configurati allo
stesso modo. [Conformità](catalog-compliance.md), [misure](catalog-performance.md).
