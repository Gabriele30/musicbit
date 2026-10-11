import type {
  CatalogKind,
  CatalogProvider,
  CatalogQuery,
  ProviderStatus,
} from '@musicbit/shared';
import { YouTubeCatalogProvider } from '../providers/youtube.js';
import { MetadataCache } from './cache.js';
import { CatalogError } from './errors.js';

function integer(name: string, fallback: number, min: number, max: number) {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

export class CatalogService {
  private status: ProviderStatus;
  constructor(
    private provider: CatalogProvider = new YouTubeCatalogProvider(),
    private cache = new MetadataCache(
      integer('CATALOG_TTL_MS', 300_000, 0, 86_400_000),
      integer('CATALOG_TIMEOUT_MS', 10_000, 100, 60_000),
    ),
    private enabled = process.env.YOUTUBE_CATALOG_ENABLED !== 'false',
  ) {
    this.status = {
      id: provider.id,
      name: 'YouTube Music · catalogo sperimentale',
      capabilities: ['catalog'],
      state: enabled ? 'unverified' : 'disabled',
    };
  }
  availability(): ProviderStatus {
    return structuredClone(this.status);
  }
  private async run<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ) {
    if (!this.enabled) throw new CatalogError('DISABLED');
    try {
      const result = await this.cache.get(key, load, signal);
      if (result.timing.cache !== 'hit')
        this.status = {
          ...this.status,
          state: 'available',
          lastCheckedAt: new Date().toISOString(),
          lastErrorCode: undefined,
        };
      return result;
    } catch (error) {
      const safe =
        error instanceof CatalogError ? error : new CatalogError('UNAVAILABLE');
      if (!['CANCELLED', 'BUSY', 'NOT_FOUND'].includes(safe.code))
        this.status = {
          ...this.status,
          state: 'degraded',
          lastCheckedAt: new Date().toISOString(),
          lastErrorCode: safe.code,
        };
      throw safe;
    }
  }
  async search(query: CatalogQuery, signal: AbortSignal) {
    const normalized: CatalogQuery = {
      q: query.q.trim().replace(/\s+/g, ' '),
      type: query.type,
      limit: query.limit,
    };
    const result = await this.run(
      JSON.stringify([
        this.provider.id,
        'search',
        normalized.q,
        normalized.type,
        normalized.limit,
      ]),
      (inner) => this.provider.search(normalized, inner),
      signal,
    );
    return {
      provider: this.provider.id,
      type: query.type,
      items: result.value,
      timing: result.timing,
    };
  }
  async details(kind: CatalogKind, id: string, signal: AbortSignal) {
    const result = await this.run(
      JSON.stringify([this.provider.id, 'details', kind, id]),
      (inner) => this.provider.details(kind, id, inner),
      signal,
    );
    if (!result.value) throw new CatalogError('NOT_FOUND');
    return { item: result.value, timing: result.timing };
  }
  async home(signal: AbortSignal) {
    const result = await this.run(
      JSON.stringify([this.provider.id, 'home']),
      (inner) => this.provider.home?.(inner) ?? Promise.resolve([]),
      signal,
    );
    return { sections: result.value, timing: result.timing };
  }
  async recommendations(id: string, signal: AbortSignal) {
    const result = await this.run(
      JSON.stringify([this.provider.id, 'radio', id]),
      (inner) =>
        this.provider.recommendations?.(id, inner) ?? Promise.resolve([]),
      signal,
    );
    return { seedId: id, items: result.value, timing: result.timing };
  }
  close() {
    this.cache.close();
  }
}
