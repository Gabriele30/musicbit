import { describe, expect, it } from 'vitest';
import { isTracksResponse, type Track } from './index.js';

const track: Track = {
  id: 'demo',
  title: 'Demo',
  artist: 'Author',
  album: 'Album',
  audioUrl: 'https://example.com/demo.mp3',
  artworkUrl: '/cover.png',
  mimeType: 'audio/mpeg',
  sourceUrl: 'https://example.com',
  permission: 'Authorized',
  attribution: 'Author',
};
describe('catalog validation', () => {
  it('accepts a path on the same origin for authorized local libraries', () => {
    expect(
      isTracksResponse({
        provider: 'local',
        tracks: [{ ...track, audioUrl: '/media/demo.mp3' }],
      }),
    ).toBe(true);
  });
  it.each([
    'https://',
    '//example.com/track.mp3',
    '/\\example.com/track.mp3',
    'http://example.com/track.mp3',
    'https://user:password@example.com/track.mp3',
  ])('rejects unsafe audio URLs: %s', (audioUrl) => {
    expect(
      isTracksResponse({ provider: 'demo', tracks: [{ ...track, audioUrl }] }),
    ).toBe(false);
  });
  it('accepts a valid response', () =>
    expect(isTracksResponse({ provider: 'demo', tracks: [track] })).toBe(true));
  it.each([
    null,
    {},
    { tracks: [] },
    { provider: 'demo', tracks: [null] },
    {
      provider: 'demo',
      tracks: [{ ...track, audioUrl: 'javascript:alert(1)' }],
    },
    { provider: 'demo', tracks: [{ ...track, attribution: '' }] },
    { provider: 'demo', tracks: [track, track] },
  ])('rejects malformed or unsafe catalogs: %j', (value) =>
    expect(isTracksResponse(value)).toBe(false),
  );
});
