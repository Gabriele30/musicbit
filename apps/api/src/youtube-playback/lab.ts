import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  PlaybackReference,
  YouTubeResolveResponse,
} from '@musicbit/shared';
import { CatalogService } from '../catalog/service.js';
import { PlaybackResolver } from '../playback/resolver.js';
import { YouTubePlaybackProvider } from './provider.js';

/** Standalone process only. Never registered in the main API or M4 lab. */
export function buildYouTubePlaybackLab(
  options: FastifyServerOptions = {},
  provider = new YouTubePlaybackProvider(),
  catalog = new CatalogService(),
  resolver = new PlaybackResolver(provider),
) {
  const app = Fastify({
    ...options,
    logController: new LogController({ disableRequestLogging: true }),
    ajv: { customOptions: { removeAdditional: false } },
  });
  const prefix = '/__youtube';
  app.addHook('onClose', async () => {
    resolver.close();
    catalog.close();
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self'; img-src 'self' https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com; connect-src 'self'; media-src 'self' https://*.googlevideo.com; frame-src https://www.youtube.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
  });
  app.get(`${prefix}/health`, async () => ({
    status: 'ok',
    experiment: 'youtube-playback-m5',
    ...provider.availability(),
  }));
  async function cancellable<T>(
    raw: import('node:http').ServerResponse,
    action: (signal: AbortSignal) => Promise<T>,
  ) {
    const controller = new AbortController();
    const close = () => {
      if (!raw.writableFinished) controller.abort();
    };
    raw.once('close', close);
    try {
      return await action(controller.signal);
    } finally {
      raw.off('close', close);
    }
  }
  app.get<{ Querystring: { q: string } }>(
    `${prefix}/api/search`,
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
          },
        },
      },
    },
    (request, reply) =>
      cancellable(reply.raw, (signal) =>
        catalog.search(
          { q: request.query.q, type: 'track', limit: 10 },
          signal,
        ),
      ),
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
            catalogProvider: { type: 'string', const: 'youtube' },
            catalogId: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
          },
        },
      },
    },
    async (
      request,
      reply,
    ): Promise<YouTubeResolveResponse | { code: string }> => {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        reply.code(403);
        return { code: 'ORIGIN_REJECTED' };
      }
      return cancellable(reply.raw, async (signal) => {
        const result = await resolver.resolve(request.body, signal);
        reply.header(
          'Server-Timing',
          `resolve;dur=${result.timing.elapsedMs.toFixed(3)}`,
        );
        // Only safe codes / status / timing in logs. Logging is off by default.
        request.log.info(
          { outcome: result.resolution.status, cache: result.timing.cache },
          'M5 resolution',
        );
        const interrupted =
          result.resolution.status === 'error' &&
          ['TIMEOUT', 'CANCELLED', 'BUSY'].includes(result.resolution.code);
        return {
          ...result,
          diagnostic: interrupted
            ? null
            : provider.diagnostic(request.body.catalogId),
        };
      });
    },
  );
  const directory = resolve('experiments/youtube-playback/dist');
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
      name: 'MusicBit · YouTube Lab',
      short_name: 'YouTube Lab',
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
    reply
      .code(invalid ? 400 : 503)
      .send({ code: invalid ? 'INVALID_INPUT' : 'UNAVAILABLE' });
  });
  return app;
}
