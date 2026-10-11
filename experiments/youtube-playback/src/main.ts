import {
  isCatalogItem,
  isPlaybackSource,
  type SearchResponse,
  type PlaybackSource,
  type YouTubeResolveResponse,
} from '@musicbit/shared';
import { LabPlayer } from '../../playback/src/controller';
import { requestJson } from '../../playback/src/request';
import { OfficialControl } from './official';
import './style.css';

document.querySelector('#app')!.innerHTML = `
  <header><span>MusicBit · M5 sperimentale</span><h1>YouTube Playback Lab</h1>
  <p>Catalogo YouTube Music. Player principale preservato.</p></header>
  <section><h2>1 · Cerca e seleziona</h2>
    <form id="search"><label for="query">Brano o artista</label><div class="row">
    <input id="query" maxlength="120" required value="Kevin MacLeod Carefree" /><button>Cerca</button></div></form>
    <p id="search-status" role="status"></p><ul id="results"></ul>
    <form id="select"><label for="video-id">Oppure video ID esatto</label><div class="row">
    <input id="video-id" pattern="[A-Za-z0-9_-]{11}" maxlength="11" required /><button>Seleziona ID</button></div></form>
    <p id="selection" role="status">Nessun brano selezionato.</p>
  </section>
  <section><h2>2 · Sorgente diretta YouTube.js</h2>
    <p id="availability">Verifica disponibilità…</p>
    <p>Richiede permessi documentati per il contenuto e per l’accesso diretto fuori dal player ufficiale.
    Nessun decipher, token, login, proxy o tentativo alternativo dopo un blocco.</p>
    <div class="row"><button id="resolve" disabled>Risolvi sorgente</button>
    <button id="stage" disabled>Risolvi come prossima</button><button id="cancel">Annulla richiesta</button></div>
    <p id="resolution" role="status">Nessuna risoluzione eseguita.</p>
    <div class="row"><button id="prepare" disabled>Prepara audio</button>
    <button id="play" disabled>Riproduci audio nativo</button><button id="pause">Pausa</button>
    <button id="next" disabled>Riproduci prossima</button></div>
    <p id="native-status" role="status"></p><div id="audio-slot"></div>
    <p>Preparazione = precaricamento esplicito, può consumare dati. Prossima = solo descrittore,
    senza una seconda richiesta audio. Click → playing misura un evento, non il primo suono fisico.</p>
  </section>
  <section><h2>3 · Controllo con player ufficiale visibile</h2>
    <p>Prova distinta: incorpora il player YouTube. Non dimostra uno stream YouTube.js né il playback nativo.
    Si mette in pausa quando la pagina è nascosta; non è un motore per lo schermo bloccato.</p>
    <p>Contenuto di controllo: “Carefree” · Kevin MacLeod (incompetech.com),
    <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, senza modifiche.
    <a href="https://incompetech.com/music/royalty-free/index.html?gt=&amp;isrc=USUAN1400037">Fonte e attribuzione</a>.
    La licenza del brano non concede il permesso di accesso allo stream YouTube diretto.</p>
    <div class="row"><button id="official-load" disabled>Carica player ufficiale</button>
    <button id="official-play" disabled>Riproduci nel player ufficiale</button></div>
    <p id="official-status" role="status">Nessun iframe caricato. Caricandolo contatti YouTube.</p>
    <div class="frame"><div id="official-player"></div></div>
  </section>
  <section><h2>Diagnostica</h2><button id="export">Esporta JSON senza URL stream</button>
    <p>HTTP 403/429 di /player sono distinti. HTMLAudioElement può esporre solo MEDIA_n per un errore cross-origin.
    loadeddata − loadstart è una stima che include rete e decodifica, non il solo buffering.</p>
    <pre id="diagnostic"></pre></section>`;
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const button = (id: string) => el<HTMLButtonElement>(id);
const audio = document.createElement('audio');
audio.controls = false;
el('audio-slot').append(audio);
const native = new LabPlayer(audio);
const resolutions: { videoId: string; roundTripMs: number; result: unknown }[] =
  [];
let selected: string | undefined;
let source: PlaybackSource | undefined;
let pending: AbortController | undefined;
let searchPending: AbortController | undefined;
let officialReady = false;
const official = new OfficialControl(el('official-player'), render);
function render() {
  const snapshot = native.snapshot();
  const lastOfficial = official.events.at(-1);
  if (lastOfficial)
    el('official-status').textContent =
      `Player ufficiale: ${lastOfficial.event}${lastOfficial.code === undefined ? '' : ` · codice ${lastOfficial.code}`}`;
  el('native-status').textContent =
    `Audio: ${snapshot.status} · errore: ${snapshot.error ?? 'nessuno'} · click → playing: ${snapshot.clickToPlayingMs?.toFixed(1) ?? 'non misurato'} ms`;
  el('diagnostic').textContent = JSON.stringify(
    {
      native: snapshot,
      resolutions,
      official: official.events,
      codecs: {
        aac: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
        opus: audio.canPlayType('audio/webm; codecs="opus"'),
      },
    },
    null,
    2,
  );
}
native.subscribe(render);
function select(id: string, title = id) {
  pending?.abort();
  pending = undefined;
  selected = id;
  source = undefined;
  el<HTMLInputElement>('video-id').value = id;
  el('selection').textContent = `Selezionato: ${title} · ${id}`;
  for (const key of ['resolve', 'stage', 'official-load'])
    button(key).disabled = false;
  for (const key of ['prepare', 'play']) button(key).disabled = true;
  if (officialReady) {
    official.pause();
    official.cue(id);
  }
  render();
}
el('select').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = el<HTMLInputElement>('video-id').value;
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) select(id);
});
el('search').addEventListener('submit', (event) => {
  event.preventDefault();
  searchPending?.abort();
  const controller = new AbortController();
  searchPending = controller;
  el('search-status').textContent = 'Ricerca in corso…';
  el('results').replaceChildren();
  void requestJson<SearchResponse>(
    `/__youtube/api/search?q=${encodeURIComponent(el<HTMLInputElement>('query').value)}`,
    controller.signal,
  )
    .then(({ ok, data }) => {
      if (controller !== searchPending) return;
      if (!ok || !Array.isArray(data.items) || !data.items.every(isCatalogItem))
        throw new Error();
      el('search-status').textContent =
        `${data.items.length} risultati YouTube Music · ${data.timing.cache} · ${data.timing.elapsedMs.toFixed(1)} ms server`;
      for (const item of data.items) {
        const li = document.createElement('li');
        const choose = document.createElement('button');
        choose.textContent = `${item.title} · ${item.artist}`;
        choose.onclick = () =>
          select(item.id, `${item.title} · ${item.artist}`);
        li.append(choose);
        el('results').append(li);
      }
    })
    .catch(() => {
      if (controller === searchPending)
        el('search-status').textContent =
          'Ricerca non disponibile o annullata.';
    });
});
function resolveSelected(stage: boolean) {
  if (!selected) return;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const id = selected;
  const start = performance.now();
  if (!stage) {
    source = undefined;
    button('play').disabled = button('prepare').disabled = true;
  }
  el('resolution').textContent = 'Risoluzione in corso…';
  void requestJson<YouTubeResolveResponse>(
    '/__youtube/api/resolve',
    controller.signal,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogProvider: 'youtube', catalogId: id }),
    },
  )
    .then(({ ok, data }) => {
      if (controller !== pending) return;
      if (!ok || !data.resolution) throw new Error();
      const r = data.resolution;
      const safe = structuredClone(data);
      if (safe.resolution.status === 'available')
        safe.resolution.source.url = '[redacted]';
      resolutions.push({
        videoId: id,
        roundTripMs: performance.now() - start,
        result: safe,
      });
      if (resolutions.length > 30) resolutions.shift();
      if (r.status === 'available' && isPlaybackSource(r.source)) {
        if (stage) {
          native.stage(r.source);
          button('next').disabled = false;
        } else {
          source = r.source;
          button('play').disabled = button('prepare').disabled = false;
        }
      }
      el('resolution').textContent =
        `${data.diagnostic?.outcome ?? (r.status === 'available' ? r.status : `${r.status}: ${r.code}`)} · ${data.timing.cache} · ${data.timing.elapsedMs.toFixed(1)} ms server`;
      render();
    })
    .catch(() => {
      if (controller === pending)
        el('resolution').textContent =
          'Risoluzione annullata, scaduta o non disponibile.';
    });
}
button('resolve').onclick = () => resolveSelected(false);
button('stage').onclick = () => resolveSelected(true);
button('cancel').onclick = () => {
  pending?.abort();
  pending = undefined;
  el('resolution').textContent = 'Richiesta annullata.';
};
button('prepare').onclick = () => {
  if (source) {
    official.pause();
    native.prepare(source);
  }
};
button('play').onclick = () => {
  if (source) {
    official.pause();
    native.play(source);
  }
};
button('pause').onclick = () => {
  native.pause();
  official.pause();
};
button('next').onclick = () => {
  official.pause();
  native.playNext();
  button('next').disabled = true;
};
button('official-load').onclick = () => {
  if (!selected) return;
  const loadingId = selected;
  native.pause();
  el('official-status').textContent = 'Caricamento SDK/iframe…';
  void official
    .load(loadingId)
    .then(() => {
      officialReady = true;
      if (selected && selected !== loadingId) official.cue(selected);
      button('official-play').disabled = false;
      el('official-status').textContent =
        'Player ufficiale pronto. Cue prepara metadati, non l’audio.';
    })
    .catch(() => {
      el('official-status').textContent = 'Player ufficiale non disponibile.';
    });
};
button('official-play').onclick = () => {
  if (selected) {
    native.pause();
    official.play(selected);
  }
};
button('export').onclick = () => {
  render();
  const blob = new Blob([el('diagnostic').textContent ?? ''], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `musicbit-m5-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
void fetch('/__youtube/health')
  .then((r) => r.json())
  .then((data: { enabled: boolean; authorizedVideoIds: string[] }) => {
    el('availability').textContent =
      `Stream diretto ${data.enabled ? 'abilitato' : 'disattivato'} · video con permessi locali validi: ${data.authorizedVideoIds.length}`;
  })
  .catch(() => {
    el('availability').textContent = 'Laboratorio non disponibile.';
  });
window.addEventListener('pagehide', () => {
  pending?.abort();
  searchPending?.abort();
});
render();
