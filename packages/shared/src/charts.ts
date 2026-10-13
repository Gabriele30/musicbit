export interface SpotifyChartEntry {
  position: number;
  change: string;
  title: string;
  artist: string;
  streams: number;
  spotifyUrl: string;
}
export interface SpotifyChart {
  market: 'it' | 'global';
  date: string;
  sourceUrl: string;
  officialUrl: string;
  stale: boolean;
  entries: SpotifyChartEntry[];
}
