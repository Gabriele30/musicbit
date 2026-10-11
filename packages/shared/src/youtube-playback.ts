import type { PlaybackResolveResponse } from './playback.js';

/** Safe diagnostics: never serialize signed media URLs, cookies, tokens or raw errors. */
export interface YouTubeFormatDiagnostic {
  itag: number;
  mime: string;
  bitrate: number;
  audio: boolean;
  video: boolean;
  directUrl: boolean;
  protected: boolean;
  durationSeconds: number | null;
  sampleRate: number | null;
}
export interface YouTubePlaybackDiagnostic {
  enabled: boolean;
  authorized: boolean;
  outcome:
    | 'DISABLED'
    | 'NO_AUTHORIZED_SOURCE'
    | 'SOURCE_UNAVAILABLE'
    | 'RESTRICTED_SOURCE'
    | 'UNSUPPORTED_FORMAT'
    | 'SOURCE_EXPIRED'
    | 'RESOLVED'
    | 'HTTP_403'
    | 'HTTP_429'
    | 'UPSTREAM_ERROR'
    | 'CANCELLED';
  upstreamMs: number | null;
  httpStatus?: number;
  retryAfterSeconds?: number;
  validUntil?: string;
  formats: YouTubeFormatDiagnostic[];
}
export interface YouTubeResolveResponse extends PlaybackResolveResponse {
  diagnostic: YouTubePlaybackDiagnostic | null;
}
