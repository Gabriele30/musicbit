import { expect, it } from 'vitest';
import { emptyLibrary, emptyTaste, type Track } from '@musicbit/shared';
import { quickPicks } from './home-personalization';

it('updates quick picks from listening and favorites while excluding blocked artists and dismissed songs', () => {
  const library = emptyLibrary();
  library.taste = emptyTaste();
  const track = (id: string, artist = id): Track => ({
    id,
    title: id,
    artist,
    audioUrl: `/api/audio/${id}`,
    artworkUrl: '',
    sourceUrl: '',
    permission: '',
    attribution: '',
    mimeType: 'audio/mp4',
  });
  library.history = ['recent', 'older', 'blocked', 'dismissed'].map((id) => ({
    track: track(id, id === 'blocked' ? '  Blocked   Artist  ' : id),
    playedAt: 1,
  }));
  library.favorites = [track('favorite')];
  library.taste!.dismissed = ['dismissed'];
  library.taste!.artistPreferences = [
    { artist: 'Blocked Artist', preference: 'blocked' },
  ];
  expect(quickPicks(library).map((t) => t.id)).toEqual([
    'recent',
    'older',
    'favorite',
  ]);
  library.history.unshift({ track: track('new-listen'), playedAt: 2 });
  expect(quickPicks(library)[0]?.id).toBe('new-listen');
  expect(quickPicks(emptyLibrary())).toEqual([]);
});
it('excludes collaborations by a blocked artist from quick picks', () => {
  const library = emptyLibrary();
  library.taste = {
    ...emptyTaste(),
    artistPreferences: [{ artist: 'Daft Punk', preference: 'blocked' }],
  };
  library.favorites = [
    {
      id: 'real',
      title: 'Instant Crush',
      artist: 'Daft Punk, Julian Casablancas',
      album: 'RAM',
      audioUrl: '/api/audio/real',
      artworkUrl: '',
      sourceUrl: '',
      permission: '',
      attribution: '',
      mimeType: 'audio/mp4',
    },
  ];
  expect(quickPicks(library)).toEqual([]);
});
