import {
  buildTasteProfile,
  type CatalogItem,
  type LocalLibrary,
} from '@musicbit/shared';
import type { CatalogService } from '../catalog/service.js';
import type { AiPlaylistService } from './ai-playlists.js';

export interface ArtistDiscovery {
  artists: CatalogItem[];
  basedOn: string[];
  source: 'ai' | 'related' | 'empty';
  pending?: boolean;
}
/** Cache bounded, verified suggestions; never let model output become catalog IDs. */
export class ArtistDiscoveryService {
  private cache = new Map<
    string,
    { until: number; result: Promise<ArtistDiscovery>; pending: boolean }
  >();
  private active = 0;
  private controllers = new Set<AbortController>();
  close() {
    for (const controller of this.controllers) controller.abort();
  }
  async get(
    user: string,
    library: LocalLibrary,
    catalog: CatalogService,
    ai: AiPlaylistService,
  ): Promise<ArtistDiscovery> {
    const profile = buildTasteProfile(library);
    const seeds = profile
      .filter((a) => a.score > 0)
      .slice(0, 5)
      .map((a) => a.artist);
    if (!seeds.length) return { artists: [], basedOn: [], source: 'empty' };
    const key = JSON.stringify([user, seeds, library.taste?.artistPreferences]);
    const now = Date.now();
    for (const [id, entry] of this.cache)
      if (entry.until < now) this.cache.delete(id);
    const old = this.cache.get(key);
    if (old) {
      const pending = old.pending;
      return { ...(await old.result), pending };
    }
    const known = profile.map((a) => a.key);
    const pending = ai.available() && this.active < 1;
    const entry = {
      until: now + 3600000,
      result: this.load(library, seeds, known, catalog, ai, false),
      pending,
    };
    if (this.cache.size >= 100)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, entry);
    if (pending) {
      this.active++;
      const controller = new AbortController();
      this.controllers.add(controller);
      void entry.result
        .then(() =>
          this.load(
            library,
            seeds,
            known,
            catalog,
            ai,
            true,
            controller.signal,
          ),
        )
        .then((value) => {
          if (this.cache.get(key) === entry && value.source === 'ai')
            entry.result = Promise.resolve(value);
        })
        .catch(() => {
          /* Retain the usable related artists. */
        })
        .finally(() => {
          entry.pending = false;
          this.active--;
          this.controllers.delete(controller);
          void entry.result
            .then((value) => {
              entry.until =
                Date.now() +
                (value.source === 'ai'
                  ? 3600000
                  : value.artists.length
                    ? 600000
                    : 60000);
            })
            .catch(() => this.cache.delete(key));
        });
    } else {
      void entry.result
        .then((value) => {
          entry.until = Date.now() + (value.artists.length ? 600000 : 60000);
        })
        .catch(() => this.cache.delete(key));
    }
    const stillPending = entry.pending;
    return { ...(await entry.result), pending: stillPending };
  }

  private async load(
    library: LocalLibrary,
    seeds: string[],
    known: string[],
    catalog: CatalogService,
    ai: AiPlaylistService,
    useAi = true,
    background?: AbortSignal,
  ): Promise<ArtistDiscovery> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(300000),
      ...(background ? [background] : []),
    ]);
    const norm = (s: string) => s.trim().toLocaleLowerCase();
    const excluded = new Set(known);
    const artists = new Map<string, CatalogItem>();
    const accept = (item: CatalogItem) => {
      if (item.kind === 'artist' && !excluded.has(norm(item.title)))
        artists.set(item.id, item);
    };
    let source: ArtistDiscovery['source'] = 'related';
    try {
      if (useAi && ai.available()) {
        const names = await ai.discoveryArtists(seeds, signal);
        for (const name of names.filter((n) => !excluded.has(norm(n)))) {
          try {
            const found = await catalog.search(
              { q: name, type: 'artist', limit: 3 },
              signal,
            );
            const item = found.items.find((i) => norm(i.title) === norm(name));
            if (item) {
              accept(item);
              source = 'ai';
            }
          } catch {
            /* Only catalog-confirmed artists are shown. */
          }
        }
      }
    } catch {
      /* Related artists provide an explicitly labelled fallback. */
    }
    if (background?.aborted)
      return { artists: [], basedOn: seeds, source: 'empty' };
    if (artists.size < 5) {
      const fallbackSignal = AbortSignal.timeout(15000);
      const references = [
        ...library.followedArtists.map((a) => a.id),
        ...library.history.map((h) => h.track.artistId),
        ...library.favorites.map((t) => t.artistId),
      ].filter((id): id is string => !!id);
      for (const id of [...new Set(references)].slice(0, 2)) {
        try {
          const detail = await catalog.details('artist', id, fallbackSignal);
          for (const artist of detail.item.relatedArtists ?? []) accept(artist);
        } catch {
          /* One unavailable artist page must not discard other results. */
        }
      }
    }
    const hydration = AbortSignal.timeout(15000);
    const selected = [...artists.values()].slice(0, 8);
    await Promise.allSettled(
      selected
        .filter((a) => !a.artworkUrl)
        .map(async (artist) => {
          const detail = await catalog.details('artist', artist.id, hydration);
          artist.artworkUrl = detail.item.artworkUrl;
        }),
    );
    return {
      artists: selected,
      basedOn: seeds,
      source: selected.length ? source : 'empty',
    };
  }
}
