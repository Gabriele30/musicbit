import { afterEach, describe, expect, it } from 'vitest';
import {
  isTracksResponse,
  type HealthResponse,
  type MusicProvider,
} from '@musicbit/shared';
import { buildApp } from './app.js';
import { DemoMusicProvider } from './providers/demo.js';

const apps: ReturnType<typeof buildApp>[] = [];
const create = (provider?: MusicProvider) => {
  const app = buildApp({}, provider);
  apps.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Fastify API', () => {
  it('reports health', async () => {
    const response = await create().inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({
      status: 'ok',
      service: 'musicbit-api',
      version: '0.1.0',
    });
  });
  it('returns three authorized tracks matching the shared contract', async () => {
    const response = await create().inject({
      method: 'GET',
      url: '/api/tracks',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['server-timing']).toMatch(/^catalog;dur=\d+\.\d+$/);
    const data: unknown = response.json();
    expect(isTracksResponse(data)).toBe(true);
    if (!isTracksResponse(data)) throw new Error('Invalid response');
    expect(data.tracks).toHaveLength(3);
    expect(
      data.tracks.every(
        (track) =>
          track.attribution.includes('T. Schürger') &&
          track.sourceUrl.startsWith('https://'),
      ),
    ).toBe(true);
  });
  it('supports another provider without changing routes', async () => {
    const provider: MusicProvider = {
      id: 'empty',
      listTracks: async () => [],
      getTrack: async () => undefined,
    };
    expect((await create(provider).inject('/api/tracks')).json()).toEqual({
      tracks: [],
      provider: 'empty',
    });
  });
  it('returns a safe error when the provider fails', async () => {
    const provider: MusicProvider = {
      id: 'failed',
      listTracks: async () => {
        throw new Error('secret internal path');
      },
      getTrack: async () => undefined,
    };
    const response = await create(provider).inject('/api/tracks');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret');
  });
  it('returns 404 for unknown endpoints', async () => {
    expect((await create().inject('/api/missing')).statusCode).toBe(404);
  });
  it('does not expose mutable catalog references', async () => {
    const provider = new DemoMusicProvider();
    const first = await provider.listTracks();
    first[0]!.title = 'modified';
    expect((await provider.getTrack('soundhelix-1'))?.title).toBe(
      'SoundHelix Song 1',
    );
    expect(await provider.getTrack('unknown')).toBeUndefined();
  });
});
