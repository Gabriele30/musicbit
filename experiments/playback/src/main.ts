import {
  isPlaybackSource,
  type PlaybackCandidate,
  type PlaybackResolveResponse,
  type PlaybackSource,
} from '@musicbit/shared';
import { LabPlayer } from './controller';
import { requestJson } from './request';
import './style.css';

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
// One element for the entire lab lifetime. Selection/search never recreate it.
const audio = document.createElement('audio');
audio.id = 'lab-audio';
document.body.append(audio);
const player = new LabPlayer(audio);
let selected: PlaybackCandidate | undefined;
let source: PlaybackSource | undefined;
let selectionRequest: AbortController | undefined;
let nextRequest: AbortController | undefined;
let searchRequest: AbortController | undefined;
let nextIndex = 2;
const resolutions: {
  trackId: string;
  roundTripMs: number;
  status: string;
  code?: string;
  cache?: string;
  serverMs?: number;
}[] = [];
const searches: { elapsedMs: number; success: boolean }[] = [];
const buttons = (enabled: boolean) => {
  element<HTMLButtonElement>('play').disabled = !enabled;
  element<HTMLButtonElement>('prepare').disabled = !enabled;
};
const render = () => {
  element('play-status').textContent =
    `${player.status}${player.error ? ` · ${player.error}` : ''}`;
  element('diagnostic').textContent = JSON.stringify(
    { ...player.snapshot(), resolutions, searches },
    null,
    2,
  );
};
player.subscribe(render);

async function resolveSource(
  candidate: PlaybackCandidate,
  controller: AbortController,
) {
  const start = performance.now();
  try {
    const { data: result } = await requestJson<PlaybackResolveResponse>(
      '/__playback/api/resolve',
      controller.signal,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate.reference),
      },
    );
    if (!result.resolution || !result.timing)
      throw new Error('INVALID_RESPONSE');
    const resolution = result.resolution;
    if (
      resolution.status === 'available' &&
      (!isPlaybackSource(resolution.source) ||
        resolution.source.reference.catalogId !==
          candidate.reference.catalogId ||
        resolution.source.reference.catalogProvider !==
          candidate.reference.catalogProvider)
    )
      throw new Error('INVALID_RESPONSE');
    resolutions.push({
      trackId: candidate.reference.catalogId,
      roundTripMs: performance.now() - start,
      status: resolution.status,
      code: resolution.status === 'available' ? undefined : resolution.code,
      cache: result.timing.cache,
      serverMs: result.timing.elapsedMs,
    });
    return resolution;
  } catch {
    resolutions.push({
      trackId: candidate.reference.catalogId,
      roundTripMs: performance.now() - start,
      status: 'error',
      code: controller.signal.aborted ? 'CANCELLED' : 'NETWORK_OR_TIMEOUT',
    });
    throw new Error('RESOLVE_FAILED');
  } finally {
    if (resolutions.length > 30) resolutions.shift();
    render();
  }
}
async function select(candidate: PlaybackCandidate) {
  selectionRequest?.abort();
  const controller = new AbortController();
  selectionRequest = controller;
  selected = candidate;
  source = undefined;
  buttons(false);
  element('selected').textContent = `${candidate.title} · ${candidate.artist}`;
  element('resolution').textContent = 'Risoluzione in corso…';
  element('rights').textContent = '';
  element<HTMLButtonElement>('resolve').disabled = false;
  try {
    const resolution = await resolveSource(candidate, controller);
    if (controller !== selectionRequest) return;
    if (resolution.status === 'available') {
      source = resolution.source;
      buttons(true);
      element('resolution').textContent =
        `Disponibile · ${source.mimeType} · validità: ${source.validUntil ?? 'scadenza non dichiarata'}`;
      element('rights').textContent =
        `${source.authorization.permission} ${source.authorization.attribution}`;
    } else
      element('resolution').textContent =
        `${resolution.status === 'unavailable' ? 'Sorgente non disponibile' : 'Errore'} · ${resolution.code}`;
  } catch {
    if (controller === selectionRequest)
      element('resolution').textContent =
        'Risoluzione fallita o scaduta. Riprova.';
  }
}
element('search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  searchRequest?.abort();
  const controller = new AbortController();
  searchRequest = controller;
  const start = performance.now();
  const query = new URLSearchParams({
    q: element<HTMLInputElement>('query').value.trim(),
    catalog: element<HTMLSelectElement>('catalog').value,
  });
  element('search-status').textContent = 'Ricerca in corso…';
  try {
    const { ok, data } = await requestJson<{ items: PlaybackCandidate[] }>(
      `/__playback/api/search?${query}`,
      controller.signal,
    );
    if (!ok) throw new Error('SEARCH_FAILED');
    if (controller !== searchRequest) return;
    const list = element('results');
    list.replaceChildren();
    for (const candidate of data.items) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${candidate.title} · ${candidate.artist}`;
      button.addEventListener('click', () => {
        void select(candidate);
      });
      li.append(button);
      list.append(li);
    }
    element('search-status').textContent = `${data.items.length} risultati`;
    searches.push({ elapsedMs: performance.now() - start, success: true });
  } catch {
    if (controller === searchRequest)
      element('search-status').textContent = 'Ricerca fallita o scaduta.';
    searches.push({ elapsedMs: performance.now() - start, success: false });
  } finally {
    if (searches.length > 20) searches.shift();
    render();
  }
});
element('resolve').addEventListener('click', () => {
  if (selected) void select(selected);
});
element('prepare').addEventListener('click', () => {
  if (source) player.prepare(source);
});
element('play').addEventListener('click', () => {
  if (source) player.play(source);
});
element('pause').addEventListener('click', () => player.pause());
element('cancel').addEventListener('click', () => player.cancelPreparation());
element('next').addEventListener('click', async () => {
  nextRequest?.abort();
  const controller = new AbortController();
  nextRequest = controller;
  element('next-status').textContent = 'Risoluzione prossima demo…';
  const candidate: PlaybackCandidate = {
    reference: {
      catalogProvider: 'soundhelix-demo',
      catalogId: `soundhelix-${nextIndex}`,
    },
    title: '',
    artist: '',
    sourceUrl: '',
  };
  try {
    const resolution = await resolveSource(candidate, controller);
    if (controller !== nextRequest) return;
    if (resolution.status === 'available' && player.stage(resolution.source)) {
      element('next-status').textContent =
        `Descrittore pronto: ${resolution.source.title}. Nessun byte audio precaricato.`;
      element<HTMLButtonElement>('play-next').disabled = false;
      nextIndex = (nextIndex % 3) + 1;
    } else
      element('next-status').textContent = 'Prossima sorgente non disponibile.';
  } catch {
    if (controller === nextRequest)
      element('next-status').textContent = 'Risoluzione prossima fallita.';
  }
});
element('play-next').addEventListener('click', () => {
  player.playNext();
  element<HTMLButtonElement>('play-next').disabled = true;
});
element('export').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob([element('diagnostic').textContent ?? ''], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `musicbit-m4-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
