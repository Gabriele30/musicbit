import type { Track } from './index.js';
export interface ContinuousPlan {
  ids: string[];
  autoplay?: boolean;
  maxTracks?: number;
}
export interface ContinuousTrack {
  index: number;
  id: string;
  start: number;
  duration: number;
}
export interface ContinuousTimeline {
  tracks: ContinuousTrack[];
  complete: boolean;
  error?: string;
  additions?: { index: number; track: Track }[];
}
