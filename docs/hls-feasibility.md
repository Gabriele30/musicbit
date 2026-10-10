# HLS continuo: prova isolata M2

**Decisione:** tecnicamente fattibile una timeline AAC live generata sul server,
con un solo src HLS sul client. Non sostituire il player MP3 prima di prove fisiche
Safari/PWA, lock screen e CarPlay. HLS non conferisce automaticamente permessi
di background e non garantisce il target di avvio rapido.

## Prova realizzata

`experiments/hls/server.mjs` avvia FFmpeg in tempo reale con toni matematici
originali a 220/330/440 Hz, dieci secondi ciascuno, ripetuti. Nessuna sorgente
esterna viene scaricata o convertita. Una sola codifica AAC, 48 kHz stereo 96 kb/s,
segmenti MPEG-TS ~2 s, playlist rolling di sei segmenti, PROGRAM-DATE-TIME.
La continuità è generata prima del segmentatore: non si concatenano playlist VOD.

Server su loopback 4180, file solo nella cartella ignorata `artifacts/hls/session-*`.
Ogni sessione produce al massimo 300 s (configurabili 8–3600 con HLS_DURATION);
vecchi segmenti eliminati dall’encoder, nessuna sessione modifica file sorgente
del player. Output delle sessioni precedenti resta disponibile per ispezione.
FFmpeg/ffprobe sono dipendenze opzionali del laboratorio, non della build o CI.
Verificato qui con FFmpeg build 2026-01-29 c898ddb8fe.

`pnpm experiment:hls`; attendere almeno tre secondi, poi
`http://127.0.0.1:4180/` sul desktop o
`https://<IP-LAN>:4443/__hls/` attraverso `pnpm test:https`.
La pagina ha un solo audio nativo e rileva canPlayType HLS. Non aggiunge hls.js
per mascherare un browser che non dichiara supporto nativo. I toni sono a volume
basso; annotare il punto della timeline da cui il player live effettivamente parte.

`pnpm smoke:hls` avvia una propria sessione di 18 s, osserva la playlist live da
sequence 0 a 1 (sei segmenti), legge due segmenti adiacenti, verifica 188 pacchetti
AAC e li decodifica con FFmpeg. Gap massimo PTS osservato **~1 μs**, entro
arrotondamento dei timestamp. Evidenza [hls-smoke.json](performance/hls-smoke.json).
Prova PTS su segmenti adiacenti e una prova di decodifica non sono una verifica
di continuità percepita, di cambio brano musicale arbitrario o del client iOS.

## Benefici attesi e costi da verificare

Una sorgente live evita che `ended` e nuovo src richiedano JavaScript a ogni
cambio brano. È un possibile aiuto quando la pagina è sospesa; la policy del
browser può comunque interrompere l’audio, il trasporto o i comandi di sistema.
La finestra live comporta nuova latenza: pubblicare il primo segmento richiede
circa due secondi, e il client può attendere più segmenti. Un HLS standard live
può quindi partire più lentamente di un MP3 preparato. Nessun LL-HLS implementato.

Per una sorgente musicale eterogenea occorre normalizzare codec, sample rate,
canali, timeline e loudness. AAC già compatibile può consentire stream copy solo
con confini e timestamp coerenti; MP3 eterogenei non diventano automaticamente
un unico AAC continuo senza conversione. Non introdurre transcodifica nel player
principale senza misure CPU, qualità, consumo, latenza e buffer su Debian/iPhone.

Un canale continuo complica pause/seek/successivo: un seek nel buffer live non è
un cambio brano. Comandi server-side richiederebbero una timeline/coda per sessione,
gestione client lenti e aggiornamenti metadati coerenti con il playhead. ID3 timed
metadata o un canale applicativo vanno progettati e provati; aggiornamenti React
in background non sono una garanzia. Il laboratorio non implementa queste API,
né sostituisce MusicProvider o Media Session del player principale.

## Gate prima di adottarlo

- Misurare click→playing e primo suono con HLS già caldo vs MP3 preparato sulla
  stessa rete/dispositivo, cinque campioni per condizione; includere costo server.
- Osservare più cambi di tono a telefono bloccato ≥5 minuti in Safari e Home,
  senza modificare src; raccogliere JSON e prova esterna, non solo eventi JS.
- Ripetere cambi Wi-Fi/cellulare, sospensione, audio routing, CarPlay cablato e
  wireless. La finestra live di ~12 s può essere insufficiente dopo un’interruzione.
- Misurare CPU/RAM/banda, gap reali su confini musicali, recupero segmenti scaduti,
  timestamp e metadati/comandi. Validare deployment HTTPS e durate lunghe.

Tutti questi gate sono **da eseguire**; il laboratorio serve a renderli concreti.
Fonti: [Apple HLS](https://developer.apple.com/documentation/http-live-streaming),
[RFC 8216](https://datatracker.ietf.org/doc/rfc8216/),
[FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls).
