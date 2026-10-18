import { Innertube, Platform, Log } from 'youtubei.js';
import { PoTokenService } from './potoken.js';
import { MetadataCache } from '../catalog/cache.js';
import { CatalogError } from '../catalog/errors.js';
import { fetchMetadata } from './network.js';
import { fragmentedAacPatches, type AudioBytePatch } from './mp4.js';

export interface ResolvedAudioStream {
  url: string;
  mimeType: string;
  contentLength?: number;
  durationSeconds?: number;
  expiresAt: number;
  patches?: AudioBytePatch[];
}

export class AudioResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'UNAVAILABLE'
      | 'PROVIDER_RESTRICTED'
      | 'INVALID_ID'
      | 'TIMEOUT'
      | 'BUSY'
      | 'CANCELLED' = 'UNAVAILABLE',
    public readonly status = 503,
  ) {
    super(message);
    this.name = 'AudioResolutionError';
  }
}

export class ProviderAudioResolver {
  private clientPromise?: Promise<Innertube>;
  private cache: MetadataCache;
  private poTokenService = new PoTokenService();

  constructor(
    options: {
      timeoutMs?: number;
      capacity?: number;
      maxConcurrent?: number;
    } = {},
  ) {
    this.cache = new MetadataCache(
      15 * 60 * 1000,
      options.timeoutMs ?? 45000,
      options.capacity ?? 100,
      options.maxConcurrent ?? 8,
    );
  }

  private async getClient(): Promise<Innertube> {
    if (!this.clientPromise) {
      Log.setLevel(Log.Level.NONE);
      // Ensure custom JavaScript interpreter is set up for URL deciphering
      Platform.shim.eval = async (data: { output: string }) => {
        return new Function(data.output)();
      };

      this.clientPromise = Innertube.create({
        lang: 'en',
        location: 'IT',
        generate_session_locally: true,
        retrieve_player: true,
        enable_session_cache: true,
        fetch: fetchMetadata,
      }).catch((err) => {
        this.clientPromise = undefined;
        throw err;
      });
    }
    return this.clientPromise;
  }

  evict(videoId: string): void {
    this.cache.evict(videoId);
  }

  close(): void {
    this.cache.close();
  }

  async resolve(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<ResolvedAudioStream> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      throw new AudioResolutionError('ID video non valido', 'INVALID_ID', 400);
    }

    const subscriber = signal ?? new AbortController().signal;
    const load = (sharedSignal: AbortSignal) =>
      this.fetchAndDecipher(videoId, sharedSignal);
    try {
      let result = await this.cache.get(videoId, load, subscriber);
      if (result.value.expiresAt <= Date.now() + 60000) {
        this.evict(videoId);
        result = await this.cache.get(videoId, load, subscriber);
      }
      if (result.value.expiresAt <= Date.now() + 60000) {
        this.evict(videoId);
        throw new AudioResolutionError('Stream scaduto. Riprova tra poco.');
      }
      return result.value;
    } catch (error) {
      if (error instanceof CatalogError) {
        const statuses = {
          TIMEOUT: 504,
          BUSY: 429,
          CANCELLED: 499,
          UNAVAILABLE: 503,
          DISABLED: 503,
          NOT_FOUND: 404,
        };
        throw new AudioResolutionError(
          error.code === 'TIMEOUT'
            ? 'Il brano ha impiegato troppo tempo. Riprova.'
            : 'Stream temporaneamente non disponibile. Riprova.',
          error.code === 'DISABLED' ? 'UNAVAILABLE' : error.code,
          statuses[error.code],
        );
      }
      throw error;
    }
  }

  protected async fetchAndDecipher(
    videoId: string,
    signal?: AbortSignal,
  ): Promise<ResolvedAudioStream> {
    // Independent initialization and metadata requests overlap on a cold start.
    const tokenPromise = this.poTokenService
      .mintPoToken(videoId)
      .catch(() => undefined);
    const client = await this.getClient();
    signal?.throwIfAborted();
    let info;
    try {
      // First try YouTube Music API (WEB_REMIX client)
      info = await client.music.getInfo(videoId);
    } catch {
      try {
        // Fallback to general YouTube client
        info = await client.getInfo(videoId);
      } catch {
        throw new AudioResolutionError(
          'Impossibile trovare la traccia. Riprova tra poco.',
          'NOT_FOUND',
          404,
        );
      }
    }

    signal?.throwIfAborted();
    const formats = [
      ...(info.streaming_data?.adaptive_formats ?? []),
      ...(info.streaming_data?.formats ?? []),
    ];

    if (!formats.length) {
      const restricted = info.playability_status?.status === 'LOGIN_REQUIRED';
      throw new AudioResolutionError(
        restricted
          ? 'Il fornitore richiede una verifica di accesso dal server. I brani già in cache restano disponibili.'
          : 'Nessun formato streaming disponibile per questo brano',
        restricted ? 'PROVIDER_RESTRICTED' : 'UNAVAILABLE',
        503,
      );
    }

    // Prioritize AAC 128k (itag 140, audio/mp4) for best iOS / cross-browser compatibility
    const format =
      formats.find((f) => f.itag === 140) ||
      formats.find((f) => f.mime_type?.includes('mp4a')) ||
      formats.find((f) => f.itag === 251) || // Opus fallback
      formats.find((f) => f.has_audio || f.mime_type?.startsWith('audio/')) ||
      info.chooseFormat({ type: 'audio', quality: 'best' });

    if (!format) {
      throw new AudioResolutionError(
        'Nessun formato audio idoneo trovato',
        'UNAVAILABLE',
        503,
      );
    }

    let streamUrl: string | undefined;
    if (format.signature_cipher || format.cipher) {
      if (!client.session.player) {
        throw new AudioResolutionError(
          'Player script non inizializzato',
          'UNAVAILABLE',
          503,
        );
      }
      streamUrl = await format.decipher(client.session.player);
    } else if (format.url) {
      streamUrl = format.url;
    }

    if (!streamUrl) {
      throw new AudioResolutionError(
        'Impossibile decifrare il flusso audio per questo brano',
        'UNAVAILABLE',
        503,
      );
    }

    const poToken = await tokenPromise;
    signal?.throwIfAborted();
    // Ensure the PoToken is appended to the stream URL as query parameter `pot`
    if (poToken) {
      try {
        const urlObj = new URL(streamUrl);
        urlObj.searchParams.set('pot', poToken);
        streamUrl = urlObj.toString();
      } catch {
        // ignore
      }
    }

    let expiresAt = Date.now() + 5 * 60 * 60 * 1000;
    try {
      const parsed = new URL(streamUrl);
      const expireParam = parsed.searchParams.get('expire');
      if (expireParam && /^\d+$/.test(expireParam)) {
        expiresAt = Number(expireParam) * 1000;
      }
    } catch {
      // ignore
    }

    signal?.throwIfAborted();
    const mimeType = format.mime_type?.split(';')[0]?.trim() || 'audio/mp4';
    let patches: AudioBytePatch[] | undefined;
    const initEnd = format.init_range?.end;
    if (
      format.mime_type?.includes('mp4a.40.2') &&
      !format.has_video &&
      initEnd !== undefined &&
      initEnd >= 0 &&
      initEnd < 65536
    ) {
      // Inspect only the small initialization segment, once per cached descriptor.
      // Never buffer or transcode the complete song. Inspection failure preserves
      // the original stream; a caller cancellation still aborts resolution.
      try {
        const response = await fetchMetadata(streamUrl, {
          headers: {
            Range: `bytes=0-${initEnd}`,
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://music.youtube.com/',
            Origin: 'https://music.youtube.com',
          },
          signal,
        });
        const reader = response.body?.getReader();
        if (reader) {
          try {
            if (response.ok) {
              const chunks: Buffer[] = [];
              let length = 0;
              while (length <= initEnd) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value).subarray(
                  0,
                  initEnd + 1 - length,
                );
                chunks.push(chunk);
                length += chunk.length;
              }
              if (length === initEnd + 1)
                patches = fragmentedAacPatches(Buffer.concat(chunks, length));
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        }
      } catch {
        signal?.throwIfAborted();
      }
    }

    return {
      url: streamUrl,
      mimeType,
      contentLength: format.content_length
        ? Number(format.content_length)
        : undefined,
      durationSeconds:
        Number(info.basic_info.duration) > 0
          ? Number(info.basic_info.duration)
          : format.approx_duration_ms
            ? Math.round(Number(format.approx_duration_ms) / 1000)
            : undefined,
      expiresAt,
      patches: patches?.length ? patches : undefined,
    };
  }
}
