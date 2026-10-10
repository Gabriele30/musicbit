import Fastify, { type FastifyServerOptions } from 'fastify';
import type {
  HealthResponse,
  MusicProvider,
  TracksResponse,
} from '@musicbit/shared';
import { DemoMusicProvider } from './providers/demo.js';

export function buildApp(
  options: FastifyServerOptions = {},
  provider: MusicProvider = new DemoMusicProvider(),
) {
  const app = Fastify(options);
  app.get<{ Reply: HealthResponse }>('/health', async () => ({
    status: 'ok',
    service: 'musicbit-api',
    version: '0.1.0',
  }));
  app.get<{ Reply: TracksResponse }>('/api/tracks', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const start = performance.now();
    const tracks = await provider.listTracks();
    reply.header(
      'Server-Timing',
      `catalog;dur=${(performance.now() - start).toFixed(2)}`,
    );
    return { tracks, provider: provider.id };
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply
      .status(500)
      .send({ error: 'Il catalogo non è disponibile. Riprova tra poco.' });
  });
  return app;
}
