import type {
  PlaybackProvider,
  PlaybackReference,
  PlaybackResolution,
  YouTubePlaybackDiagnostic,
} from '@musicbit/shared';
import {
  type StreamingGateway,
  StreamingError,
  YouTubeStreamingGateway,
} from './gateway.js';
import {
  parsePermissions,
  type YouTubePermission,
  videoIdPattern,
} from './permissions.js';

/** Experimental, fail closed. Does not call decipher, download, media hosts or the main engine. */
export class YouTubePlaybackProvider implements PlaybackProvider {
  readonly id = 'youtube-playback-experimental';
  private records: YouTubePermission[];
  private diagnostics = new Map<string, YouTubePlaybackDiagnostic>();
  constructor(
    readonly enabled = false,
    permissions: unknown = [],
    private gateway: StreamingGateway = new YouTubeStreamingGateway(),
  ) {
    this.records = parsePermissions(permissions);
  }
  availability() {
    return {
      enabled: this.enabled,
      authorizedVideoIds: this.records
        .filter((record) => Date.parse(record.expiresAt) > Date.now() + 5000)
        .map((record) => record.videoId),
    };
  }
  diagnostic(id: string): YouTubePlaybackDiagnostic | null {
    const value = this.diagnostics.get(id);
    return value ? structuredClone(value) : null;
  }
  async resolve(
    reference: PlaybackReference,
    signal: AbortSignal,
  ): Promise<PlaybackResolution> {
    const record = this.records.find(
      (r) =>
        r.videoId === reference.catalogId &&
        Date.parse(r.expiresAt) > Date.now() + 5000,
    );
    const diagnostic: YouTubePlaybackDiagnostic = {
      enabled: this.enabled,
      authorized: !!record,
      outcome: this.enabled ? 'NO_AUTHORIZED_SOURCE' : 'DISABLED',
      upstreamMs: null,
      formats: [],
    };
    // Store the live object now: a late cancelled request must not overwrite a newer probe.
    this.diagnostics.delete(reference.catalogId);
    this.diagnostics.set(reference.catalogId, diagnostic);
    while (this.diagnostics.size > 100)
      this.diagnostics.delete(this.diagnostics.keys().next().value!);
    const unavailable = (): PlaybackResolution => ({
      status: 'unavailable',
      code: 'NO_AUTHORIZED_SOURCE',
    });
    let start: number | undefined;
    try {
      if (signal.aborted) {
        diagnostic.outcome = 'CANCELLED';
        return { status: 'error', code: 'CANCELLED', retryable: false };
      }
      if (
        !this.enabled ||
        !record ||
        reference.catalogProvider !== 'youtube' ||
        !videoIdPattern.test(reference.catalogId)
      )
        return unavailable();
      start = performance.now();
      const info = await this.gateway.inspect(reference.catalogId, signal);
      signal.throwIfAborted();
      diagnostic.formats = info.formats.slice(0, 100).map((f) => ({
        itag: f.itag,
        mime: f.mime,
        bitrate: f.bitrate,
        audio: f.audio,
        video: f.video,
        directUrl: !!f.url,
        protected: f.protected,
        durationSeconds: f.durationSeconds ?? null,
        sampleRate: f.sampleRate ?? null,
      }));
      if (!info.playable) {
        diagnostic.outcome = 'SOURCE_UNAVAILABLE';
        return { status: 'unavailable', code: 'NOT_FOUND' };
      }
      const formats = info.formats.filter(
        (f) =>
          f.audio &&
          !f.video &&
          /^audio\/mp4;\s*codecs="mp4a\.40\.[25]"$/i.test(f.mime),
      );
      const format = formats
        .filter((f) => !f.protected && f.url)
        .sort((a, b) => a.bitrate - b.bitrate)[0];
      if (!format?.url) {
        diagnostic.outcome = formats.some((f) => f.protected)
          ? 'RESTRICTED_SOURCE'
          : 'UNSUPPORTED_FORMAT';
        return { status: 'unavailable', code: 'UNSUPPORTED_FORMAT' };
      }
      const url = new URL(format.url);
      if (
        url.protocol !== 'https:' ||
        !url.hostname.endsWith('.googlevideo.com') ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== '/videoplayback'
      ) {
        diagnostic.outcome = 'RESTRICTED_SOURCE';
        return { status: 'error', code: 'INVALID_SOURCE', retryable: false };
      }
      const expires = url.searchParams.get('expire');
      const sourceExpiry = Math.min(
        Number.isFinite(info.expiresAt) ? info.expiresAt! : Infinity,
        expires && /^\d+$/.test(expires) ? Number(expires) * 1000 : Infinity,
      );
      const validUntil = Math.min(Date.parse(record.expiresAt), sourceExpiry);
      if (
        !Number.isFinite(sourceExpiry) ||
        !Number.isFinite(validUntil) ||
        validUntil <= Date.now() + 5000
      ) {
        diagnostic.outcome = 'SOURCE_EXPIRED';
        return { status: 'unavailable', code: 'NOT_FOUND' };
      }
      diagnostic.outcome = 'RESOLVED';
      diagnostic.validUntil = new Date(validUntil).toISOString();
      return {
        status: 'available',
        source: {
          provider: this.id,
          reference,
          url: format.url,
          mimeType: 'audio/mp4',
          delivery: 'progressive',
          title: record.title,
          artist: record.artist,
          durationSeconds: format.durationSeconds,
          validUntil: diagnostic.validUntil,
          authorization: {
            sourceUrl: record.contentPermissionUrl,
            permission: `Operator-verified content and service permissions: ${record.servicePermissionUrl}`,
            attribution: record.attribution,
          },
        },
      };
    } catch (error) {
      diagnostic.outcome = signal.aborted
        ? 'CANCELLED'
        : error instanceof StreamingError && error.status === 403
          ? 'HTTP_403'
          : error instanceof StreamingError && error.status === 429
            ? 'HTTP_429'
            : 'UPSTREAM_ERROR';
      if (error instanceof StreamingError) {
        diagnostic.httpStatus = error.status;
        diagnostic.retryAfterSeconds = error.retryAfterSeconds;
      }
      return {
        status: 'error',
        code: signal.aborted ? 'CANCELLED' : 'PROVIDER_UNAVAILABLE',
        retryable: false,
      };
    } finally {
      if (start !== undefined)
        diagnostic.upstreamMs = performance.now() - start;
    }
  }
}
