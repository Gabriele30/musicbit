import { JSDOM } from 'jsdom';
import type { FastifyInstance } from 'fastify';
import type { SpotifyChart } from '@musicbit/shared';
import { MetadataCache } from './cache.js';
import { CatalogError } from './errors.js';

export function parseSpotifyChart(
  html: string,
  market: SpotifyChart['market'],
  now = Date.now(),
): SpotifyChart {
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const region = market === 'it' ? 'Italy' : 'Global';
    const rawDate = doc.body.textContent?.match(
      new RegExp(`Spotify Daily Chart - ${region} - (\\d{4}/\\d{2}/\\d{2})`),
    )?.[1];
    if (!rawDate) throw new Error('Missing chart date');
    const date = rawDate.replaceAll('/', '-');
    const time = Date.parse(`${date}T00:00:00Z`);
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== date ||
      time > now + 86400000
    )
      throw new Error('Invalid chart date');
    const entries: SpotifyChart['entries'] = [];
    for (const row of doc.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) continue;
      const anchor =
        cells[2]!.querySelector<HTMLAnchorElement>('a[href*="/track/"]');
      const id = anchor
        ?.getAttribute('href')
        ?.match(/\/track\/([A-Za-z0-9]{22})\.html$/)?.[1];
      const title = anchor?.textContent?.trim();
      const artist = [...cells[2]!.querySelectorAll('a[href*="/artist/"]')]
        .map((a) => a.textContent?.trim())
        .filter(Boolean)
        .join(', ');
      const position = Number(cells[0]!.textContent?.trim());
      const streams = Number(cells[6]!.textContent?.replaceAll(',', '').trim());
      if (
        !id ||
        !title ||
        !artist ||
        position !== entries.length + 1 ||
        !Number.isSafeInteger(streams) ||
        streams < 0
      )
        throw new Error('Invalid chart row');
      entries.push({
        position,
        title: title.slice(0, 300),
        artist: artist.slice(0, 300),
        change: cells[1]!.textContent?.trim().slice(0, 12) || '=',
        streams,
        spotifyUrl: `https://open.spotify.com/track/${id}`,
      });
      if (entries.length === 20) break;
    }
    if (entries.length < 10) throw new Error('Incomplete chart');
    return {
      market,
      date,
      entries,
      sourceUrl: `https://kworb.net/spotify/country/${market}_daily.html`,
      officialUrl: `https://charts.spotify.com/charts/view/regional-${market}-daily/latest`,
      stale: now - time > 3 * 86400000,
    };
  } finally {
    dom.window.close();
  }
}

export function registerSpotifyCharts(
  app: FastifyInstance,
  upstream: typeof fetch = fetch,
) {
  const cache = new MetadataCache(600000, 10000, 2, 2);
  app.addHook('onClose', async () => cache.close());
  app.get<{ Querystring: { market?: 'it' | 'global' } }>(
    '/api/charts/spotify',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { market: { type: 'string', enum: ['it', 'global'] } },
        },
      },
    },
    async (request) => {
      if (process.env.MUSICBIT_CHARTS_ENABLED === 'false')
        throw new CatalogError('DISABLED');
      const market = request.query.market ?? 'it';
      const result = await cache.get(
        market,
        async (signal) => {
          const response = await upstream(
            `https://kworb.net/spotify/country/${market}_daily.html`,
            { signal, redirect: 'error' },
          );
          if (!response.ok) throw new CatalogError('UNAVAILABLE');
          const html = await response.text();
          if (html.length > 2000000) throw new CatalogError('UNAVAILABLE');
          try {
            return parseSpotifyChart(html, market);
          } catch {
            throw new CatalogError('UNAVAILABLE');
          }
        },
        AbortSignal.timeout(11000),
      );
      return result.value;
    },
  );
}
