import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  cleanLibrary,
  isLocalLibrary,
  type AccountProfile,
  type LocalLibrary,
} from '@musicbit/shared';
import { AccountError, AccountStore } from './store.js';

function token(request: FastifyRequest) {
  return (
    request.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('musicbit_session='))
      ?.slice(17) ?? ''
  );
}
function secureCookie(request: FastifyRequest) {
  return (
    process.env.AUTH_COOKIE_SECURE === 'true' ||
    request.protocol === 'https' ||
    request.headers['x-forwarded-proto'] === 'https' ||
    request.headers.origin?.startsWith('https://') === true
  );
}
const cookie = (value: string, secure: boolean, age = 30 * 86400) =>
  `musicbit_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
export function registerAccountRoutes(
  app: FastifyInstance,
  store: AccountStore,
  options: { continuousPlayback?: boolean } = {},
) {
  const attempts = new Map<string, { count: number; until: number }>();
  let active = 0;
  const requireUser = (request: FastifyRequest): AccountProfile => {
    const user = store.session(token(request));
    if (!user)
      throw new AccountError(
        401,
        'SIGN_IN_REQUIRED',
        'Accedi per aprire la tua libreria sincronizzata.',
      );
    const expected = request.headers['x-musicbit-account'];
    if (expected !== undefined && expected !== user.id)
      throw new AccountError(
        401,
        'ACCOUNT_CHANGED',
        'L’account è cambiato in un’altra scheda. Ricarica MusicBit prima di sincronizzare.',
      );
    return user;
  };
  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.url.startsWith('/api/auth/') &&
      !request.url.startsWith('/api/me/')
    )
      return;
    reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .header('X-Content-Type-Options', 'nosniff');
    // Custom header + no CORS prevent browser cross-origin writes, including login CSRF.
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      (request.headers['x-musicbit-request'] !== '1' ||
        request.headers['sec-fetch-site'] === 'cross-site')
    )
      throw new AccountError(
        403,
        'CROSS_SITE_REQUEST',
        'Riapri MusicBit e riprova.',
      );
  });
  const limited = async <T>(request: FastifyRequest, run: () => Promise<T>) => {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const key = request.ip;
    const entry = attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
    if (
      entry.count >= 20 ||
      active >= 4 ||
      (!attempts.has(key) && attempts.size >= 1000)
    )
      throw new AccountError(
        429,
        'TOO_MANY_ATTEMPTS',
        'Troppi tentativi. Attendi qualche minuto e riprova.',
      );
    entry.count++;
    attempts.set(key, entry);
    active++;
    try {
      return await run();
    } finally {
      active--;
    }
  };
  const credentials = {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 32 },
      password: { type: 'string', minLength: 1, maxLength: 128 },
    },
  };
  app.get('/api/auth/session', async (request, reply) => {
    const sessionToken = token(request);
    const user = store.session(sessionToken);
    // Renew on application open: a user who keeps using MusicBit does not have
    // to sign in again every 30 days. Expired tokens are never revived.
    if (user && store.extendSession(sessionToken))
      reply.header('Set-Cookie', cookie(sessionToken, secureCookie(request)));
    return {
      user: user ?? null,
      registrationEnabled: process.env.AUTH_REGISTRATION !== 'false',
      continuousPlayback: !!user && options.continuousPlayback === true,
    };
  });
  for (const operation of ['login', 'register'] as const)
    app.post<{ Body: { username: string; password: string } }>(
      `/api/auth/${operation}`,
      { schema: { body: credentials }, bodyLimit: 2048 },
      async (request, reply) =>
        limited(request, async () => {
          if (
            operation === 'register' &&
            process.env.AUTH_REGISTRATION === 'false'
          )
            throw new AccountError(
              403,
              'REGISTRATION_CLOSED',
              'La creazione di account è disattivata.',
            );
          const { username, password } = request.body;
          const user =
            operation === 'login'
              ? await store.authenticate(username, password)
              : await store.createUser(username, password);
          store.logout(token(request));
          reply.header(
            'Set-Cookie',
            cookie(store.createSession(user.id), secureCookie(request)),
          );
          return {
            user,
            continuousPlayback: options.continuousPlayback === true,
          };
        }),
    );
  app.post('/api/auth/logout', async (request, reply) => {
    store.logout(token(request));
    reply.header('Set-Cookie', cookie('', secureCookie(request), 0));
    return { ok: true };
  });
  app.get('/api/me/library', async (request) =>
    store.library(requireUser(request).id),
  );
  app.put<{ Body: { revision: number; library: LocalLibrary } }>(
    '/api/me/library',
    { bodyLimit: 5_000_000 },
    async (request) => {
      const user = requireUser(request);
      const body = request.body;
      if (
        !body ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        !isLocalLibrary(body.library)
      )
        throw new AccountError(
          400,
          'INVALID_LIBRARY',
          'Il file della libreria non è valido o supera i limiti.',
        );
      return store.saveLibrary(
        user.id,
        body.revision,
        cleanLibrary(body.library),
      );
    },
  );
  app.put<{ Body: { displayName: string; color: string } }>(
    '/api/me/profile',
    {
      bodyLimit: 2048,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['displayName', 'color'],
          properties: {
            displayName: {
              type: 'string',
              minLength: 1,
              maxLength: 40,
              pattern: '^[^\\u0000-\\u001f]+$',
            },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          },
        },
      },
    },
    async (request) => {
      if (!request.body.displayName.trim())
        throw new AccountError(
          400,
          'INVALID_PROFILE',
          'Inserisci il nome del profilo.',
        );
      return {
        user: store.updateProfile(
          requireUser(request).id,
          request.body.displayName,
          request.body.color,
        ),
      };
    },
  );
  app.post<{ Body: { currentPassword: string; password: string } }>(
    '/api/me/password',
    {
      bodyLimit: 2048,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['currentPassword', 'password'],
          properties: {
            currentPassword: { type: 'string', minLength: 1, maxLength: 128 },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) =>
      limited(request, async () => {
        const user = requireUser(request);
        await store.changePassword(
          user.id,
          request.body.currentPassword,
          request.body.password,
        );
        reply.header(
          'Set-Cookie',
          cookie(store.createSession(user.id), secureCookie(request)),
        );
        return { ok: true };
      }),
  );
  return { requireUser };
}
