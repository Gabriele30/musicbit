import type { Track } from './index.js';
export interface ContinuousPlan {
  ids: string[];
  autoplay?: boolean;
  maxTracks?: number;
  /** Replaces an abandoned native session from the same browser window. */
  deviceId?: string;
  /** Absolute index of ids[0] after the retained radio window advances. */
  queueStart?: number;
}
export interface ContinuousTrack {
  index: number;
  id: string;
  start: number;
  duration: number;
}
export interface ContinuousTimeline {
  /** Monotonic session snapshot version; discard delayed older responses. */
  revision?: number;
  tracks: ContinuousTrack[];
  complete: boolean;
  error?: string;
  notice?: string;
  additions?: { index: number; track: Track }[];
  /** First program index retained by the server. Starts stay absolute. */
  queueStart?: number;
}
