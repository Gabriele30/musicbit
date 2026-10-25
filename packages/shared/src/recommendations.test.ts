import { describe, expect, it } from 'vitest';
import {
  emptyLibrary,
  personalRecommendations,
  isLocalLibrary,
  type CatalogItem,
  catalogItemToTrack,
  emptyTaste,
  automaticMixes,
  recommendationSeeds,
  hasArtist,
  cleanLibrary,
  buildTasteProfile,
  isCatalogItem,
} from './index.js';
const item = (id: string, artist = 'Artist', title = id): CatalogItem => ({
  id,
  kind: 'track',
  provider: 'youtube',
  title,
  artist,
  sourceUrl: `https://music.youtube.com/watch?v=${id}`,
  playback: { available: true },
});
describe('personal discovery', () => {
  it('does not build a musical taste artist from the provider missing-credit placeholder', () => {
    const library = emptyLibrary();
    library.favorites = [
      catalogItemToTrack(item('unknown0001', 'Artista non indicato')),
    ];
    library.followedArtists = [
      {
        ...item('UC1234567890123456789012', 'MadMan'),
        kind: 'artist',
        title: 'MadMan',
      },
    ];
    expect(buildTasteProfile(library).map((entry) => entry.artist)).toEqual([
      'MadMan',
    ]);
    expect(
      personalRecommendations(library, [
        item('unknown0001', 'Artista non indicato'),
        item('known000001', 'MadMan'),
      ]).map((entry) => entry.item.id),
    ).toEqual(['known000001']);
  });
  it('starts each radio refill with another artist when possible, instead of resetting variety at every seed', () => {
    const library = emptyLibrary();
    const lazza = item('lazza000001', 'Lazza');
    const collaboration = {
      ...item('lazza000002', 'Lazza, Guest'),
      artists: ['Lazza', 'Guest'],
    };
    const marracash = item('marracash01', 'Marracash');
    library.favorites = [
      catalogItemToTrack(lazza),
      catalogItemToTrack(collaboration),
    ];
    const ranked = personalRecommendations(
      library,
      [lazza, collaboration, marracash],
      { previousArtist: 'Lazza' },
    );
    expect(ranked[0]?.item.id).toBe(marracash.id);
    expect(ranked).toHaveLength(3);
    // A single-artist pool must still play rather than returning an empty radio.
    expect(
      personalRecommendations(library, [lazza], { previousArtist: 'Lazza' })[0]
        ?.item.id,
    ).toBe(lazza.id);
  });
  it('applies blocked artist preferences to collaborations, including legacy saved credits', () => {
    const library = emptyLibrary();
    library.taste = {
      ...emptyTaste(),
      artistPreferences: [{ artist: 'Daft Punk', preference: 'blocked' }],
    };
    const collaboration = {
      ...item('abcdefghij1', 'Daft Punk, Pharrell Williams', 'Get Lucky'),
      artists: ['Daft Punk', 'Pharrell Williams'],
    };
    const legacy = item(
      'abcdefghij2',
      'Daft Punk, Julian Casablancas',
      'Instant Crush',
    );
    const allowed = item('abcdefghij3', 'Nu Genea', 'Tienaté');
    library.favorites = [
      catalogItemToTrack(collaboration),
      catalogItemToTrack(legacy),
      catalogItemToTrack(allowed),
    ];
    expect(
      personalRecommendations(library, [collaboration, legacy, allowed]).map(
        (entry) => entry.item.id,
      ),
    ).toEqual([allowed.id]);
    expect(recommendationSeeds(library).map((track) => track.id)).toEqual([
      allowed.id,
    ]);
    for (const mix of automaticMixes(library, [collaboration, legacy, allowed]))
      expect(mix.tracks.every((track) => !hasArtist(track, 'Daft Punk'))).toBe(
        true,
      );
    const cleaned = cleanLibrary(library);
    expect(cleaned.favorites[0]!.artists).toEqual([
      'Daft Punk',
      'Pharrell Williams',
    ]);
    expect(
      hasArtist(
        { artist: 'Earth, Wind & Fire', artists: ['Earth, Wind & Fire'] },
        'Earth',
      ),
    ).toBe(false);
    expect(
      hasArtist(
        { artist: 'Earth, Wind & Fire', artists: ['Earth, Wind & Fire'] },
        'Earth, Wind & Fire',
      ),
    ).toBe(true);
    expect(isCatalogItem({ ...collaboration, artists: [{}] })).toBe(false);
  });
  it('lets explicit less/more preferences override a large historical play count', () => {
    const lib = emptyLibrary();
    const familiar = item('abcdefghij1', 'Familiar');
    lib.favorites = [catalogItemToTrack(familiar)];
    lib.history = [{ track: catalogItemToTrack(familiar), playedAt: 1 }];
    lib.taste = {
      ...emptyTaste(),
      artistPreferences: [{ artist: 'Familiar', preference: 'less' }],
      signals: [{ id: familiar.id, completed: 1000, skipped: 0 }],
    };
    expect(
      personalRecommendations(lib, [familiar, item('abcdefghij2', 'New')], {
        includeRecent: true,
      })[0]!.item.artist,
    ).toBe('New');
    lib.taste.artistPreferences = [{ artist: 'Familiar', preference: 'more' }];
    expect(
      personalRecommendations(lib, [item('abcdefghij2', 'New'), familiar], {
        includeRecent: true,
      })[0]!.item.artist,
    ).toBe('Familiar');
    expect(recommendationSeeds(lib)[0]!.artist).toBe('Familiar');
  });
  it('normalizes artist spacing for repetition, duplicates and explicit blocks', () => {
    const lib = emptyLibrary();
    const candidates = [
      item('abcdefghij1', 'Nu Genea', 'Tienaté'),
      item('abcdefghij2', ' nu  genea ', ' Tienaté '),
      item('abcdefghij3', 'NU GENEA', 'Marechià'),
      item('abcdefghij4', ' Nu Genea', 'Bar Mediterraneo'),
      item('abcdefghij5', 'Other'),
    ];
    expect(
      personalRecommendations(lib, candidates).map((r) => r.item.id),
    ).toEqual(['abcdefghij1', 'abcdefghij5', 'abcdefghij3']);
    lib.taste = {
      novelty: 'balanced',
      dismissed: [],
      signals: [],
      artistPreferences: [{ artist: ' NU  GENEA ', preference: 'blocked' }],
    };
    expect(
      personalRecommendations(lib, candidates).map((r) => r.item.id),
    ).toEqual(['abcdefghij5']);
  });
  it('filters dismissed/recent songs and duplicate titles, and caps artist repetition', () => {
    const lib = emptyLibrary();
    lib.taste = {
      novelty: 'balanced',
      dismissed: ['abcdefghij1'],
      signals: [],
    };
    const ranked = personalRecommendations(lib, [
      item('abcdefghij1'),
      item('abcdefghij2'),
      item('abcdefghij3'),
      item('abcdefghij4'),
      item('abcdefghij5', 'Other'),
      item('abcdefghij6', 'Other', 'abcdefghij5'),
    ]);
    expect(ranked.map((r) => r.item.id)).toEqual([
      'abcdefghij2',
      'abcdefghij5',
      'abcdefghij3',
    ]);
  });
  it('avoids consecutive artists and alternate IDs of recently heard or queued songs', () => {
    const lib = emptyLibrary();
    const a = item('abcdefghij1', 'First', 'One');
    const b = item('abcdefghij2', 'First', 'Two');
    const c = item('abcdefghij3', 'Second', 'Three');
    expect(
      personalRecommendations(lib, [a, b, c]).map((entry) => entry.item.id),
    ).toEqual([a.id, c.id, b.id]);
    lib.history = [{ track: catalogItemToTrack(a), playedAt: Date.now() }];
    const alias = item('abcdefghij4', ' FIRST ', '  One  ');
    expect(
      personalRecommendations(lib, [alias, b]).map((entry) => entry.item.id),
    ).toEqual([b.id]);
    expect(
      personalRecommendations(emptyLibrary(), [alias, b], {
        excludeTracks: [catalogItemToTrack(a)],
      }).map((entry) => entry.item.id),
    ).toEqual([b.id]);
    const dismissed = {
      ...emptyLibrary(),
      taste: { ...emptyTaste(), dismissed: [a.id] },
    };
    expect(
      personalRecommendations(dismissed, [a, alias, b]).map(
        (entry) => entry.item.id,
      ),
    ).toEqual([b.id]);
  });
  it('selects diverse fresh seeds and rejects blocked, ignored and heavily skipped tracks', () => {
    const lib = emptyLibrary();
    const tracks = [
      item('abcdefghij1', 'Recent'),
      item('abcdefghij2', 'Recent'),
      item('abcdefghij3', 'Blocked'),
      item('abcdefghij4', 'Skipped'),
      item('abcdefghij5', 'Other'),
    ].map(catalogItemToTrack);
    lib.history = tracks.map((track) => ({ track, playedAt: Date.now() }));
    lib.taste = {
      ...emptyTaste(),
      artistPreferences: [{ artist: 'Blocked', preference: 'blocked' }],
      signals: [{ id: tracks[3]!.id, completed: 0, skipped: 10 }],
    };
    expect(recommendationSeeds(lib).map((track) => track.id)).toEqual([
      tracks[0]!.id,
      tracks[4]!.id,
      tracks[1]!.id,
    ]);
  });
  it('sorts all repeat candidates before applying the thirty-track mix limit', () => {
    const lib = emptyLibrary();
    lib.favorites = Array.from({ length: 31 }, (_, index) =>
      catalogItemToTrack(
        item(`mix${String(index).padStart(8, '0')}`, 'Artist'),
      ),
    );
    lib.taste = {
      ...emptyTaste(),
      signals: [{ id: lib.favorites[30]!.id, completed: 50, skipped: 0 }],
    };
    const mix = automaticMixes(lib, []).find((entry) => entry.id === 'repeat')!;
    expect(mix.tracks).toHaveLength(30);
    expect(mix.tracks[0]!.id).toBe(lib.favorites[30]!.id);
  });
  it('uses followed artists and negative feedback, with an explanation', () => {
    const lib = emptyLibrary();
    lib.followedArtists = [
      {
        ...item('UCabcdefghijklmnopqrstuv', 'Artist', 'Favorite'),
        kind: 'artist',
      },
    ];
    lib.taste = {
      novelty: 'balanced',
      dismissed: [],
      signals: [{ id: 'abcdefghij1', completed: 0, skipped: 10 }],
    };
    const ranked = personalRecommendations(lib, [
      item('abcdefghij1', 'Favorite'),
      item('abcdefghij2', 'Favorite'),
      item('abcdefghij3', 'Other'),
    ]);
    expect(ranked[0]?.item.id).toBe('abcdefghij2');
    expect(ranked[0]?.reason).toContain('Favorite');
    expect(ranked.at(-1)?.item.id).toBe('abcdefghij1');
  });
  it('rejects invalid storage contracts', () => {
    expect(isLocalLibrary(emptyLibrary())).toBe(true);
    expect(
      isLocalLibrary({
        ...emptyLibrary(),
        taste: {
          novelty: 'balanced',
          dismissed: [],
          signals: [{ id: 'x', completed: -1, skipped: 0 }],
        },
      }),
    ).toBe(false);
  });
});
