# Catalogo sperimentale: servizio e conformità

> Documento storico del catalogo M3, prima dell'integrazione audio. Il comportamento
> attuale di catalogo, proxy e dati locali è descritto in [Providers and privacy](providers.md).
> Le affermazioni seguenti sull'assenza di playback e cronologia descrivono quel milestone.

M3 usa `youtubei.js@18.1.0`, libreria MIT, per metadati anonimi YouTube Music.
È un adapter di un’API privata non ufficiale, senza SLA, stabilità o supporto
garantiti. La licenza della libreria non concede diritti sui contenuti né
un’autorizzazione automatica all’accesso al servizio.

I [termini YouTube](https://www.youtube.com/static?template=terms), nella sezione
Permissions and Restrictions, limitano l’accesso automatizzato, salvo le eccezioni
previste o il permesso scritto del servizio. L’uso personale/self-hosted non è
di per sé una di tali autorizzazioni. La disponibilità tecnica e il successo dei
test non provano conformità: prima di esporre o distribuire l’integrazione occorre
valutare i termini applicabili e ottenere le autorizzazioni necessarie. Il provider
può essere disabilitato con `YOUTUBE_CATALOG_ENABLED=false`, preservando le demo.

Titoli, metadati, marchi e miniature restano riferiti ai rispettivi titolari;
il collegamento alla sorgente non è una licenza. MusicBit non scarica né conserva
audio YouTube, non estrae URL di streaming e non offre Play/accodamento di catalogo.
Non richiede login, credenziali, cookie personali, token di sessione forniti dall’utente
o aggiramento di restrizioni. Non effettua ricerche pagine dopo pagina, radio,
raccomandazioni, download immagini sul server, testi o biografie.

Le query sono inviate dal backend al servizio; le miniature sono richieste dal
browser ai relativi host, senza referrer. Il server conserva query e metadati solo
nella cache RAM con TTL/capacità limitati. Non ci sono account, database o storico
ricerche. Log applicativi e proxy incluso escludono query, header e payload remoti;
eventuali strumenti o proxy aggiunti dall’operatore possono richiedere interventi
equivalenti. Prima di condividere diagnostica M2, verificare UA, URL e orari.

La [FAQ ufficiale della libreria](https://ytjs.dev/guide/faq) descrive i possibili
blocchi di IP server. In caso di blocchi, limitazioni regionali, CAPTCHA o richiesta
di account, MusicBit mostra indisponibilità e non implementa evasione. Cache TTL,
debounce e single-flight riducono le richieste; non rimuovono vincoli del servizio.

Fonti tecniche primarie consultate il 10 ottobre 2026:
[opzioni di sessione](https://ytjs.dev/guide/getting-started),
[client Music](https://ytjs.dev/api/youtubei.js/namespaces/Clients/classes/Music),
e sorgenti/types del pacchetto npm installato. `retrieve_player=false` disabilita
il recupero del player; la guardia fetch restringe ulteriormente gli endpoint.
Le prove reali sono documentate separatamente in [catalog-performance.md](catalog-performance.md).
