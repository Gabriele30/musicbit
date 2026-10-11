import { AsyncLocalStorage } from 'node:async_hooks';
import { Innertube, Log } from 'youtubei.js';

export interface StreamFormat {
  itag: number;
  mime: string;
  bitrate: number;
  audio: boolean;
  video: boolean;
  url?: string;
  protected: boolean;
  durationSeconds?: number;
  sampleRate?: number;
}
export interface StreamInfo {
  playable: boolean;
  expiresAt?: number;
  formats: StreamFormat[];
}
export interface StreamingGateway {
  inspect(videoId: string, signal: AbortSignal): Promise<StreamInfo>;
}
export class StreamingError extends Error {
  constructor(
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super('YouTube streaming request unavailable');
  }
}
interface Scope {
  videoId: string;
  signal: AbortSignal;
}

/** Only /player for the explicitly authorized ID. No credentials, redirects or fallbacks. */
export function guardedPlayerFetch(
  scope: AsyncLocalStorage<Scope>,
  transport: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const active = scope.getStore();
    if (!active || active.signal.aborted) throw new StreamingError();
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.youtube.com' ||
      url.port ||
      url.pathname !== '/youtubei/v1/player' ||
      request.method !== 'POST' ||
      url.username ||
      url.password ||
      request.headers.has('authorization') ||
      request.headers.has('cookie')
    )
      throw new StreamingError();
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    const context = body.context as
      | { client?: { clientName?: string } }
      | undefined;
    if (
      body.videoId !== active.videoId ||
      context?.client?.clientName !== 'WEB' ||
      body.serviceIntegrityDimensions ||
      body.poToken ||
      body.signatureTimestamp ||
      (body.playbackContext &&
        JSON.stringify(body.playbackContext).includes('signatureTimestamp'))
    )
      throw new StreamingError();
    // Do not affirm age/content warnings on the listener's behalf.
    body.racyCheckOk = false;
    body.contentCheckOk = false;
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const response = await transport(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([active.signal, request.signal]),
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const seconds =
        retry && /^\d+$/.test(retry)
          ? Math.min(Number(retry), 86400)
          : undefined;
      await response.body?.cancel();
      // Never let youtubei.js include a response body / request URL in its raw error.
      throw new StreamingError(response.status, seconds);
    }
    return response;
  };
}

/** getStreamingData implicitly deciphers; getBasicInfo only inspects raw formats. */
export class YouTubeStreamingGateway implements StreamingGateway {
  private scope = new AsyncLocalStorage<Scope>();
  private client?: Promise<Innertube>;
  constructor(private transport: typeof fetch = fetch) {}
  inspect(videoId: string, signal: AbortSignal): Promise<StreamInfo> {
    return this.scope.run({ videoId, signal }, async () => {
      Log.setLevel(Log.Level.NONE);
      this.client ??= Innertube.create({
        retrieve_player: false,
        generate_session_locally: true,
        retrieve_innertube_config: false,
        enable_session_cache: false,
        enable_safety_mode: true,
        fetch: guardedPlayerFetch(this.scope, this.transport),
      });
      const client = await this.client;
      if (signal.aborted) throw new StreamingError();
      const info = await client.getBasicInfo(videoId);
      const data = info.streaming_data;
      return {
        playable: info.playability_status?.status === 'OK',
        expiresAt: data?.expires.getTime(),
        formats: [
          ...(data?.formats ?? []),
          ...(data?.adaptive_formats ?? []),
        ].map((f) => ({
          itag: f.itag,
          mime: f.mime_type,
          bitrate: f.bitrate,
          audio: f.has_audio,
          video: f.has_video,
          url: f.url,
          protected: !!(
            f.cipher ||
            f.signature_cipher ||
            f.drm_families?.length ||
            f.fair_play_key_uri ||
            f.drm_track_type
          ),
          durationSeconds: Number.isFinite(f.approx_duration_ms)
            ? f.approx_duration_ms / 1000
            : undefined,
          sampleRate: Number.isFinite(f.audio_sample_rate)
            ? f.audio_sample_rate
            : undefined,
        })),
      };
    });
  }
}
