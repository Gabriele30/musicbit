import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogItemToTrack, type CatalogItem } from '@musicbit/shared';
import { buildApp } from '../app.js';
import { AccountStore } from './store.js';
import { AiPlaylistService } from './ai-playlists.js';
import { CatalogService } from '../catalog/service.js';
const item: CatalogItem = {
  id: 'abcdefghijk',
  kind: 'track',
  provider: 'youtube',
  title: 'Real Song',
  artist: 'Real Artist',
  sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
  playback: { available: true },
};
const track = catalogItemToTrack(item);
const apps: ReturnType<typeof buildApp>[] = [];
const headers = { 'x-musicbit-request': '1' };
async function setup() {
  const store = new AccountStore(),
    app = buildApp({}, undefined, undefined, undefined, store);
  apps.push(app);
  const user = await store.createUser('listener', 'password-123');
  const cookie = `musicbit_session=${store.createSession(user.id)}`;
  return { app, store, user, headers: { ...headers, cookie } };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('cross-device listening and Wrapped', () => {
  it('protects playback handoff with revisions and keeps queues isolated between accounts', async () => {
    const { app, store, headers: h } = await setup(),
      session = {
        queue: [track, track],
        index: 1,
        position: 42,
        repeat: 'off',
        autoplay: true,
      };
    expect((await app.inject('/api/me/playback')).statusCode).toBe(401);
    const put = (revision: number, deviceId = 'device-first') =>
      app.inject({
        method: 'PUT',
        url: '/api/me/playback',
        headers: h,
        payload: { revision, session, deviceId },
      });
    expect((await put(0)).statusCode).toBe(200);
    expect((await put(0, 'device-other')).statusCode).toBe(409);
    const get = (
      await app.inject({ url: '/api/me/playback', headers: h })
    ).json();
    expect(get.session).toEqual(session);
    expect(get.revision).toBe(1);
    expect((await put(1, 'device-other')).json().revision).toBe(2);
    const other = await store.createUser('different', 'password-123');
    expect(
      (
        await app.inject({
          url: '/api/me/playback',
          headers: {
            cookie: `musicbit_session=${store.createSession(other.id)}`,
          },
        })
      ).json().session,
    ).toBeNull();
  });
  it('records idempotent real listening chunks and does not resurrect deleted stats on delayed retries', async () => {
    const { app, headers: h } = await setup(),
      at = Date.now(),
      event = {
        id: 'event-abcdefgh',
        track,
        at,
        seconds: 45,
        starts: 1,
        completed: false,
      };
    const post = (events: unknown[]) =>
      app.inject({
        method: 'POST',
        url: '/api/me/listening',
        headers: h,
        payload: { events },
      });
    expect((await post([event])).statusCode).toBe(200);
    await post([event]);
    const year = new Date(at).getUTCFullYear(),
      stats = () =>
        app.inject({ url: `/api/me/stats?year=${year}`, headers: h });
    expect((await stats()).json()).toMatchObject({
      seconds: 45,
      plays: 1,
      distinctTracks: 1,
    });
    expect(
      (await post([{ ...event, id: 'different-event', seconds: 5000 }]))
        .statusCode,
    ).toBe(400);
    expect(
      (await post([{ ...event, id: 'old-event-123', at: at - 8 * 86400000 }]))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ url: '/api/me/stats?year=oops', headers: h }))
        .statusCode,
    ).toBe(400);
    await app.inject({ method: 'DELETE', url: '/api/me/stats', headers: h });
    await post([{ ...event, id: 'late-pending-event' }]);
    expect((await stats()).json().seconds).toBe(0);
  });
  it('rejects a stale initial revision without inserting a session', async () => {
    const { app, headers: h } = await setup();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/me/playback',
          headers: h,
          payload: {
            revision: 7,
            session: { queue: [track], index: 0, position: 0, repeat: 'off' },
            deviceId: 'device-123',
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ url: '/api/me/playback', headers: h })).json()
        .revision,
    ).toBe(0);
  });
});
describe('AI playlist verification', () => {
  it('generates with a local Ollama model without an API key', async () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OPENAI_API_KEY', '');
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          done: true,
          response: JSON.stringify({
            name: 'Mix locale',
            description: 'Musica selezionata.',
            songs: [{ title: item.title, artist: item.artist }],
          }),
        }),
      ),
    );
    const catalog = new CatalogService({
      id: 'youtube',
      search: async () => [item],
      details: async () => undefined,
    });
    try {
      const service = new AiPlaylistService();
      expect(service.available()).toBe(true);
      const result = await service.generate(
        'Una playlist',
        5,
        undefined,
        catalog,
        new AbortController().signal,
      );
      expect(result.tracks).toHaveLength(1);
      expect(String(request.mock.calls[0]?.[0])).toContain('/api/generate');
      expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).model).toBe(
        'qwen2.5:1.5b',
      );
    } finally {
      catalog.close();
    }
  });
  it('resolves model suggestions against catalog metadata, reports missing songs and deduplicates tracks', async () => {
    const plan = vi.fn(async () => ({
      name: 'Night mix',
      description: 'Un viaggio musicale.',
      songs: [
        { title: 'Real Song', artist: 'Real Artist' },
        { title: 'Invented', artist: 'Nobody' },
        { title: 'Real Song', artist: 'Real Artist' },
      ],
    }));
    const catalog = new CatalogService({
      id: 'youtube',
      search: async () => [item],
      details: async () => undefined,
    });
    const service = new AiPlaylistService(plan),
      controller = new AbortController();
    const result = await service.generate(
      'Night music',
      5,
      undefined,
      catalog,
      controller.signal,
    );
    expect(result.tracks.map((t) => t.id)).toEqual([item.id]);
    expect(result.unmatched).toEqual([{ title: 'Invented', artist: 'Nobody' }]);
    catalog.close();
  });
  it('stays unavailable without a key and never makes a billed request during tests', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { app, headers: h } = await setup();
    expect(
      (
        await app.inject({ url: '/api/me/ai-playlists/status', headers: h })
      ).json().available,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/me/ai-playlists',
          headers: h,
          payload: { prompt: 'Night music', count: 12, useTaste: false },
        })
      ).statusCode,
    ).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
