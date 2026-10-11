import Fastify, { type FastifyServerOptions } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PlaybackCandidate, PlaybackReference } from '@musicbit/shared';
import { DemoMusicProvider } from '../providers/demo.js';
import { CatalogService } from '../catalog/service.js';
import { PlaybackResolver } from './resolver.js';

/** Deliberately NOT registered in buildApp or deployed with the main PWA. */
export function buildPlaybackLab(
  options: FastifyServerOptions = {},
  resolver = new PlaybackResolver(),
  catalog = new CatalogService(),
) {
  const app = Fastify({
    ...options,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const demo = new DemoMusicProvider();
  const prefix = '/__playback';
  app.addHook('onClose', async () => {
    resolver.close();
    catalog.close();
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  app.get(`${prefix}/health`, async () => ({
    status: 'ok',
    experiment: 'playback-m4',
  }));
  app.get<{ Querystring: { q: string; catalog: 'demo' | 'youtube' } }>(
    `${prefix}/api/search`,
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
            catalog: {
              type: 'string',
              enum: ['demo', 'youtube'],
              default: 'demo',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once('close', closed);
      try {
        let items: PlaybackCandidate[];
        if (request.query.catalog === 'youtube') {
          const result = await catalog.search(
            { q: request.query.q, type: 'track', limit: 10 },
            controller.signal,
          );
          items = result.items.map((item) => ({
            reference: { catalogProvider: item.provider, catalogId: item.id },
            title: item.title,
            artist: item.artist,
            sourceUrl: item.sourceUrl,
          }));
        } else {
          items = (await demo.listTracks())
            .filter((track) =>
              `${track.title} ${track.artist}`
                .toLowerCase()
                .includes(request.query.q.trim().toLowerCase()),
            )
            .map((track) => ({
              reference: { catalogProvider: demo.id, catalogId: track.id },
              title: track.title,
              artist: track.artist,
              sourceUrl: track.sourceUrl,
            }));
        }
        return { items };
      } finally {
        reply.raw.off('close', closed);
      }
    },
  );
  app.post<{ Body: PlaybackReference }>(
    `${prefix}/api/resolve`,
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['catalogProvider', 'catalogId'],
          properties: {
            catalogProvider: {
              type: 'string',
              enum: ['soundhelix-demo', 'youtube'],
            },
            catalogId: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              pattern: '^[A-Za-z0-9_-]+$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once('close', closed);
      try {
        const result = await resolver.resolve(request.body, controller.signal);
        reply.header(
          'Server-Timing',
          `resolve;dur=${result.timing.elapsedMs.toFixed(3)}`,
        );
        const failure = result.resolution;
        if (failure.status === 'error')
          reply.code(
            failure.code === 'TIMEOUT'
              ? 504
              : failure.code === 'BUSY'
                ? 429
                : failure.code === 'CANCELLED'
                  ? 499
                  : 503,
          );
        return result;
      } finally {
        reply.raw.off('close', closed);
      }
    },
  );
  const directory = resolve('experiments/playback/dist');
  app.get(`${prefix}/`, async (_request, reply) =>
    reply
      .type('text/html')
      .send(await readFile(resolve(directory, 'index.html'))),
  );
  app.get<{ Params: { file: string } }>(
    `${prefix}/assets/:file`,
    async (request, reply) => {
      if (!/^[A-Za-z0-9_-]+\.(js|css)$/.test(request.params.file))
        return reply.code(404).send();
      return reply
        .type(
          request.params.file.endsWith('.js') ? 'text/javascript' : 'text/css',
        )
        .send(
          await readFile(resolve(directory, 'assets', request.params.file)),
        );
    },
  );
  app.get(`${prefix}/icon.png`, async (_request, reply) =>
    reply
      .type('image/png')
      .send(await readFile('apps/web/public/icons/icon-192.png')),
  );
  app.get(`${prefix}/manifest.webmanifest`, async (_request, reply) =>
    reply.type('application/manifest+json').send({
      id: `${prefix}/`,
      name: 'MusicBit · Playback Lab',
      short_name: 'MusicBit Lab',
      start_url: `${prefix}/`,
      scope: `${prefix}/`,
      display: 'standalone',
      background_color: '#101312',
      theme_color: '#101312',
      icons: [
        { src: `${prefix}/icon.png`, sizes: '192x192', type: 'image/png' },
      ],
    }),
  );
  app.setErrorHandler((error, _request, reply) => {
    const invalid = error && typeof error === 'object' && 'validation' in error;
    reply.code(invalid ? 400 : 503).send({
      code: invalid ? 'INVALID_INPUT' : 'UNAVAILABLE',
      error: invalid ? 'Parametri non validi.' : 'Laboratorio non disponibile.',
    });
  });
  return app;
}
