import {
  isPlaybackSource,
  isSourceFresh,
  type PlaybackProvider,
  type PlaybackReference,
  type PlaybackResolution,
  type PlaybackResolveResponse,
  type PlaybackSource,
} from '@musicbit/shared';
import { MetadataCache } from '../catalog/cache.js';
import { CatalogError } from '../catalog/errors.js';
import { AuthorizedDemoPlaybackProvider } from './demo.js';

/** Memory cache stores only authorized descriptors, never audio bytes or credentials. */
export class PlaybackResolver {
  private values = new Map<
    string,
    { source: PlaybackSource; expires: number }
  >();
  private flights: MetadataCache;
  constructor(
    private provider: PlaybackProvider = new AuthorizedDemoPlaybackProvider(),
    private ttlMs = 60_000,
    timeoutMs = 10_000,
  ) {
    this.flights = new MetadataCache(0, timeoutMs, 100, 16);
  }
  async resolve(
    reference: PlaybackReference,
    signal: AbortSignal,
  ): Promise<PlaybackResolveResponse> {
    const start = performance.now();
    const key = JSON.stringify([
      this.provider.id,
      reference.catalogProvider,
      reference.catalogId,
    ]);
    if (signal.aborted) return this.failure('CANCELLED', start);
    const stored = this.values.get(key);
    if (stored && stored.expires > Date.now() && isSourceFresh(stored.source)) {
      this.values.delete(key);
      this.values.set(key, stored);
      return {
        resolution: {
          status: 'available',
          source: structuredClone(stored.source),
        },
        timing: { cache: 'hit', elapsedMs: performance.now() - start },
      };
    }
    this.values.delete(key);
    try {
      const result = await this.flights.get(
        key,
        (inner) => this.provider.resolve(reference, inner),
        signal,
      );
      let resolution: PlaybackResolution = result.value;
      if (resolution.status === 'available') {
        const source = resolution.source;
        if (
          !isPlaybackSource(source) ||
          !isSourceFresh(source) ||
          source.reference.catalogId !== reference.catalogId ||
          source.reference.catalogProvider !== reference.catalogProvider
        ) {
          resolution = {
            status: 'error',
            code: 'INVALID_SOURCE',
            retryable: true,
          };
        } else {
          const expires = Math.min(
            Date.now() + this.ttlMs,
            source.validUntil === null
              ? Infinity
              : Date.parse(source.validUntil) - 5000,
          );
          if (expires > Date.now()) {
            this.values.set(key, { source: structuredClone(source), expires });
            while (this.values.size > 100)
              this.values.delete(this.values.keys().next().value!);
          }
        }
      }
      return { resolution, timing: result.timing };
    } catch (error) {
      const code =
        error instanceof CatalogError &&
        ['TIMEOUT', 'CANCELLED', 'BUSY'].includes(error.code)
          ? (error.code as 'TIMEOUT' | 'CANCELLED' | 'BUSY')
          : 'PROVIDER_UNAVAILABLE';
      return this.failure(code, start);
    }
  }
  private failure(
    code: 'TIMEOUT' | 'CANCELLED' | 'BUSY' | 'PROVIDER_UNAVAILABLE',
    start: number,
  ): PlaybackResolveResponse {
    return {
      resolution: { status: 'error', code, retryable: code !== 'CANCELLED' },
      timing: { cache: 'miss', elapsedMs: performance.now() - start },
    };
  }
  close() {
    this.flights.close();
    this.values.clear();
  }
}
