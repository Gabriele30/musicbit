import { MetadataCache } from '../catalog/cache.js';
import { CatalogError } from '../catalog/errors.js';
import type { AudioBytePatch } from './mp4.js';
import { ProviderProcess } from './provider-process.js';

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

export class AudioStreamService {
  private cache: MetadataCache;
  private process = new ProviderProcess();

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

  evict(videoId: string): void {
    this.cache.evict(videoId);
    this.process.evict(videoId);
  }

  close(): void {
    this.cache.close();
    this.process.close();
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
    return this.process.resolve(videoId, signal);
  }
}
