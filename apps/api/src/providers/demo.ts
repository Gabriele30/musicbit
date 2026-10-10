import type { MusicProvider, Track } from '@musicbit/shared';

// Permission is the author's explicit permission with attribution, not a CC license.
// See https://www.soundhelix.com/audio-examples; audio is never downloaded by this API.
export const demoTracks: Track[] = [1, 2, 3].map((number) => ({
  id: `soundhelix-${number}`,
  title: `SoundHelix Song ${number}`,
  artist: 'T. Schürger',
  album: 'SoundHelix · Demo sessions',
  audioUrl: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${number}.mp3`,
  artworkUrl: `/artwork/session-${number}.png`,
  mimeType: 'audio/mpeg',
  sourceUrl: 'https://www.soundhelix.com/audio-examples',
  permission:
    'Uso consentito da SoundHelix con attribuzione a SoundHelix e all’artista.',
  attribution: `SoundHelix Song ${number} — T. Schürger / SoundHelix (soundhelix.com)`,
}));

export class DemoMusicProvider implements MusicProvider {
  readonly id = 'soundhelix-demo';
  async listTracks(): Promise<Track[]> {
    return structuredClone(demoTracks);
  }
  async getTrack(id: string): Promise<Track | undefined> {
    const track = demoTracks.find((item) => item.id === id);
    return track ? structuredClone(track) : undefined;
  }
}
