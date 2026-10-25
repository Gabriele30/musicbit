import { afterEach, expect, it, vi } from 'vitest';
import { catalogItemToTrack, type CatalogItem } from '@musicbit/shared';
import { buildApp } from '../app.js';
import { AccountStore } from './store.js';
import { CatalogService } from '../catalog/service.js';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
it('keeps radio-based personal recommendations when the general feed fails', async () => {
  const seed: CatalogItem = {
    id: 'abcdefghijk',
    kind: 'track',
    provider: 'youtube',
    title: 'Seed',
    artist: 'Artist',
    sourceUrl: 'https://music.youtube.com/watch?v=abcdefghijk',
    playback: { available: true },
  };
  const related: CatalogItem = { ...seed, id: 'lmnopqrstuv', title: 'Related' };
  const catalog = new CatalogService();
  vi.spyOn(catalog, 'home').mockRejectedValue(new Error('Feed unavailable'));
  const recommend = vi.spyOn(catalog, 'recommendations').mockResolvedValue({
    seedId: seed.id,
    items: [related],
    timing: { cache: 'hit', elapsedMs: 1 },
  });
  const store = new AccountStore();
  const user = await store.createUser('personal', 'test-password');
  const envelope = store.library(user.id);
  store.saveLibrary(user.id, envelope.revision, {
    ...envelope.library,
    favorites: [catalogItemToTrack(seed)],
  });
  const app = buildApp({}, undefined, catalog, undefined, store);
  apps.push(app);
  const response = await app.inject({
    url: '/api/me/recommendations',
    headers: { cookie: `musicbit_session=${store.createSession(user.id)}` },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    partial: true,
    items: [{ item: { id: related.id } }],
  });
  expect(recommend.mock.calls[0]![0]).toBe(seed.id);
});
