export const AUDIO_CACHE_QUOTA_BYTES = 5_000_000_000;
export interface AudioCachePlan {
  device: string;
  ids: string[];
}
export type AudioCacheStatus =
  | { enabled: false }
  | {
      enabled: true;
      bytes: number;
      quotaBytes: number;
      tracks: number;
      preparing: number;
    };
