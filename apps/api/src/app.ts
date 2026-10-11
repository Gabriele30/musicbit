import Fastify, { type FastifyServerOptions } from 'fastify';
import type {
  HealthResponse,
  MusicProvider,
  TracksResponse,
} from '@musicbit/shared';
import { isCatalogId, personalRecommendations } from '@musicbit/shared';
import { DemoMusicProvider } from './providers/demo.js';
import { CatalogService } from './catalog/service.js';
import { registerCatalogRoutes } from './catalog/routes.js';
import { CatalogError } from './catalog/errors.js';
import { AudioStreamService } from './audio/stream-service.js';
import { registerAudioRoutes } from './audio/routes.js';
import { AccountStore, AccountError } from './accounts/store.js';
import { registerAccountRoutes } from './accounts/routes.js';
import { registerTrafficControls } from './accounts/traffic.js';
import { registerExperienceRoutes } from './accounts/experience-routes.js';
import {
  AiPlaylistService,
  registerAiPlaylistRoutes,
} from './accounts/ai-playlists.js';

export function buildApp(
  options: FastifyServerOptions = {},
  provider: MusicProvider = new DemoMusicProvider(),
  catalog: CatalogService = new CatalogService(),
  audioService: AudioStreamService = new AudioStreamService(),
  accounts: AccountStore = new AccountStore(),
  aiPlaylists: AiPlaylistService = new AiPlaylistService(),
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
  registerTrafficControls(app, accounts);
  registerCatalogRoutes(app, catalog, provider.id);
  registerAudioRoutes(app, audioService);
  const { requireUser } = registerAccountRoutes(app, accounts);
  registerExperienceRoutes(app, accounts, requireUser);
  registerAiPlaylistRoutes(app, accounts, catalog, requireUser, aiPlaylists);
  app.get('/api/me/recommendations', async (request, reply) => {
    const user = requireUser(request);
    const library = accounts.library(user.id).library;
    const controller = new AbortController();
    const closed = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.once('close', closed);
    try {
      const seeds = [
        ...new Set(
          [...library.favorites, ...library.history.map((h) => h.track)].map(
            (t) => t.id,
          ),
        ),
      ]
        .filter((id) => isCatalogId('track', id))
        .slice(0, 3);
      const outcomes = await Promise.allSettled(
        seeds.map((id) => catalog.recommendations(id, controller.signal)),
      );
      const feed = await catalog.home(controller.signal);
      const items = [
        ...outcomes.flatMap((r) =>
          r.status === 'fulfilled' ? r.value.items : [],
        ),
        ...feed.sections.flatMap((s) => s.items),
      ];
      return {
        items: personalRecommendations(library, items),
        partial: outcomes.some((r) => r.status === 'rejected'),
      };
    } finally {
      reply.raw.off('close', closed);
    }
  });
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
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    )
      return reply.status(413).send({
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Il file supera il limite di 5 MB.',
      });
    if (error instanceof AccountError)
      return reply
        .status(error.status)
        .send({ code: error.code, error: error.message });
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
