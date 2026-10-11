import Fastify, { type FastifyServerOptions } from 'fastify';
import type {
  HealthResponse,
  MusicProvider,
  TracksResponse,
} from '@musicbit/shared';
import { DemoMusicProvider } from './providers/demo.js';
import { CatalogService } from './catalog/service.js';
import { registerCatalogRoutes } from './catalog/routes.js';
import { CatalogError } from './catalog/errors.js';
import { AudioStreamService } from './audio/stream-service.js';
import { registerAudioRoutes } from './audio/routes.js';

export function buildApp(
  options: FastifyServerOptions = {},
  provider: MusicProvider = new DemoMusicProvider(),
  catalog: CatalogService = new CatalogService(),
  audioService: AudioStreamService = new AudioStreamService(),
) {
  const logger = options.logger;
  const safeLogger = logger
    ? {
        ...(typeof logger === 'object' ? logger : {}),
        serializers: {
          req: (request: { method?: string; url?: string }) => ({
            method: request.method,
            url: request.url?.split('?')[0],
          }),
        },
      }
    : logger;
  const app = Fastify({
    ...options,
    // Search text, headers, remote errors and payloads must not enter logs.
    logger: safeLogger,
    ajv: { customOptions: { removeAdditional: false } },
  });
  registerCatalogRoutes(app, catalog, provider.id);
  registerAudioRoutes(app, audioService);
  app.addHook('onClose', async () => audioService.close());
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
    if (error && typeof error === 'object' && 'validation' in error)
      return reply
        .status(400)
        .send({ code: 'INVALID_INPUT', error: 'Parametri non validi.' });
    if (error instanceof CatalogError) {
      const status = {
        TIMEOUT: 504,
        CANCELLED: 499,
        UNAVAILABLE: 503,
        DISABLED: 503,
        NOT_FOUND: 404,
        BUSY: 429,
      }[error.code];
      const message = {
        TIMEOUT: 'Il catalogo ha impiegato troppo tempo. Riprova.',
        CANCELLED: 'Richiesta annullata.',
        UNAVAILABLE:
          'Catalogo temporaneamente non disponibile. Riprova tra poco.',
        DISABLED: 'Provider disabilitato nella configurazione.',
        NOT_FOUND: 'Elemento non trovato nel catalogo.',
        BUSY: 'Troppe richieste. Riprova tra poco.',
      }[error.code];
      request.log.warn(
        { code: error.code, provider: 'youtube' },
        'Catalog request failed',
      );
      return reply.status(status).send({ code: error.code, error: message });
    }
    request.log.error({ code: 'INTERNAL_ERROR' }, 'Request failed');
    reply
      .status(500)
      .send({ error: 'Il catalogo non è disponibile. Riprova tra poco.' });
  });
  return app;
}
