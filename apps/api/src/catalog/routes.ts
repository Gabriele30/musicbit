import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  isCatalogId,
  type CatalogKind,
  type CatalogTiming,
} from '@musicbit/shared';
import { CatalogService } from './service.js';

const querySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['q'],
  properties: {
    q: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      pattern: '^(?=.*\\S)[^\\u0000-\\u001f\\u007f]+$',
    },
    type: {
      type: 'string',
      enum: ['track', 'artist', 'album'],
      default: 'track',
    },
    limit: { type: 'integer', minimum: 1, maximum: 25, default: 15 },
    provider: { type: 'string', enum: ['youtube'], default: 'youtube' },
  },
};

/** Abort only on premature socket closure, not normal request body completion. */
async function respond<T extends { timing: CatalogTiming }>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const closed = () => {
    if (!reply.raw.writableFinished) controller.abort();
  };
  reply.raw.once('close', closed);
  reply.header('Cache-Control', 'no-store');
  try {
    const data = await run(controller.signal);
    reply.header(
      'Server-Timing',
      `metadata;dur=${data.timing.elapsedMs.toFixed(2)}`,
    );
    reply.header('X-MusicBit-Cache', data.timing.cache);
    return data;
  } finally {
    reply.raw.off('close', closed);
  }
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  service: CatalogService,
  demoProviderId: string,
) {
  app.addHook('onClose', async () => service.close());
  app.get('/api/feed', (request, reply) =>
    respond(request, reply, (signal) => service.home(signal)),
  );
  app.get<{ Params: { id: string } }>(
    '/api/recommendations/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string', minLength: 11, maxLength: 11 } },
        },
      },
    },
    (request, reply) => {
      if (!isCatalogId('track', request.params.id))
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', error: 'Identificativo non valido.' });
      return respond(request, reply, (signal) =>
        service.recommendations(request.params.id, signal),
      );
    },
  );
  app.get('/api/providers', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      providers: [
        {
          id: demoProviderId,
          name: 'SoundHelix · demo autorizzata',
          capabilities: ['playback'],
          state: 'available',
        },
        service.availability(),
      ],
    };
  });
  type Query = {
    q: string;
    type: CatalogKind;
    limit: number;
    provider: 'youtube';
  };
  app.get<{ Querystring: Query }>(
    '/api/search',
    { schema: { querystring: querySchema } },
    (request, reply) =>
      respond(request, reply, (signal) =>
        service.search(request.query, signal),
      ),
  );
  for (const [path, kind] of [
    ['artists', 'artist'],
    ['albums', 'album'],
  ] as const) {
    app.get<{ Querystring: Query }>(
      `/api/search/${path}`,
      {
        schema: {
          querystring: {
            ...querySchema,
            properties: {
              ...querySchema.properties,
              type: { type: 'string', enum: [kind], default: kind },
            },
          },
        },
      },
      (request, reply) =>
        respond(request, reply, (signal) =>
          service.search({ ...request.query, type: kind }, signal),
        ),
    );
  }
  app.get<{ Params: { kind: CatalogKind; id: string } }>(
    '/api/catalog/youtube/:kind/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['kind', 'id'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['track', 'artist', 'album'] },
            id: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { kind, id } = request.params;
      if (!isCatalogId(kind, id))
        return reply
          .code(400)
          .send({ code: 'INVALID_INPUT', error: 'Identificativo non valido.' });
      return respond(request, reply, (signal) =>
        service.details(kind, id, signal),
      );
    },
  );
}
