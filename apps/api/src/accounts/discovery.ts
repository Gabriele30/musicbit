import {
  buildTasteProfile,
  hasArtist,
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
    const pool = new Map<string, CatalogItem>();
    const accept = (item: CatalogItem) => {
      if (item.kind === 'artist' && !excluded.has(norm(item.title)))
        pool.set(norm(item.title), item);
    };
    // Existence in the catalog does not establish musical relevance. Build a
    // related-artist pool first; the model can reorder it, never expand it with
    // unrelated popular names when a small local model ignores the prompt.
    const references = seeds
      .map(
        (seed) =>
          library.followedArtists.find((a) => norm(a.title) === norm(seed))
            ?.id ??
          library.history.find(
            (h) => h.track.artistId && hasArtist(h.track, seed),
          )?.track.artistId ??
          library.favorites.find((t) => t.artistId && hasArtist(t, seed))
            ?.artistId,
      )
      .filter((id): id is string => !!id);
    const relatedSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const related = await Promise.allSettled(
      [...new Set(references)]
        .slice(0, 3)
        .map((id) => catalog.details('artist', id, relatedSignal)),
    );
    for (const result of related)
      if (result.status === 'fulfilled')
        for (const artist of result.value.item.relatedArtists ?? [])
          accept(artist);
    const artists = new Map<string, CatalogItem>();
    let source: ArtistDiscovery['source'] = 'related';
    try {
      if (useAi && ai.available() && pool.size) {
        const names = await ai.discoveryArtists(
          seeds,
          signal,
          [...pool.values()].map((item) => item.title),
        );
        for (const name of names.filter((n) => !excluded.has(norm(n)))) {
          const item = pool.get(norm(name));
          if (item) {
            artists.set(item.id, item);
            source = 'ai';
          }
        }
      }
    } catch {
      /* Related artists provide an explicitly labelled fallback. */
    }
    if (background?.aborted)
      return { artists: [], basedOn: seeds, source: 'empty' };
    for (const item of pool.values())
      if (!artists.has(item.id)) artists.set(item.id, item);
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
