import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  catalogItemToTrack,
  type CatalogItem,
  type CatalogKind,
  type DetailResponse,
  type ProviderStatus,
  type Track,
} from '@musicbit/shared';
import {
  catalogDetails,
  providerStatus,
  searchAcrossCatalog,
  type SearchKind,
} from '../search-api';
import {
  readRecentSearches,
  rememberSearch,
  saveRecentSearches,
} from '../recent-searches';
import { Icon } from './Icon';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { CoverArt } from './CoverArt';
import { CatalogShelf } from './Home';

const labels: Record<SearchKind, string> = {
  all: 'Tutto',
  track: 'Brani',
  artist: 'Artisti',
  album: 'Album',
};
const availability: Record<ProviderStatus['state'], string> = {
  available: 'Catalogo disponibile',
  unverified: 'Disponibilità da verificare',
  degraded: 'Ultima richiesta fallita',
  disabled: 'Provider disabilitato',
};

function Artwork({ item }: { item: CatalogItem }) {
  return (
    <CoverArt
      src={item.artworkUrl}
      title={item.title}
      artist={item.kind === 'artist'}
    />
  );
}

function ResultList({
  items,
  select,
  onPlayTrack,
  onEnqueueTrack,
}: {
  items: CatalogItem[];
  select: (item: CatalogItem) => void;
  onPlayTrack?: (track: Track) => void;
  onEnqueueTrack?: (track: Track) => void;
}) {
  return (
    <ul className="catalog-results">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="catalog-item-row">
          <button
            className="catalog-result"
            onClick={() => select(item)}
            aria-label={`Dettagli ${item.title}`}
          >
            <Artwork item={item} />
            <span className="track-copy">
              <strong>{item.title}</strong>
              <small>
                {item.artist}
                {item.album ? ` · ${item.album}` : ''}
              </small>
              <span className="catalog-tag">
                {labels[item.kind]}
                {item.durationSeconds !== undefined &&
                  ` · ${Math.floor(item.durationSeconds / 60)}:${String(
                    Math.floor(item.durationSeconds % 60),
                  ).padStart(2, '0')}`}
              </span>
            </span>
          </button>
          <div className="catalog-actions">
            {item.kind === 'track' && item.playback.available ? (
              <>
                <button
                  type="button"
                  className="icon-button play-action-btn"
                  aria-label={`Riproduci ${item.title}`}
                  title="Riproduci ora"
                  onClick={() => onPlayTrack?.(catalogItemToTrack(item))}
                >
                  <Icon name="play" size={20} />
                </button>
                <button
                  type="button"
                  className="icon-button queue-action-btn"
                  aria-label={`Aggiungi alla coda ${item.title}`}
                  title="Aggiungi alla coda"
                  onClick={() => onEnqueueTrack?.(catalogItemToTrack(item))}
                >
                  <Icon name="plus" size={20} />
                </button>
              </>
            ) : (
              <Icon name="arrow" size={18} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Search({
  active = true,
  onPlayTrack,
  onEnqueueTrack,
  onPlayAlbum,
  onEnqueueAlbum,
  favoriteIds = [],
  onToggleFavorite,
  openRequest,
  queryRequest,
  savedIds = [],
  onToggleSaved,
  onAddPlaylist,
  onDetailChange,
}: {
  active?: boolean;
  onPlayTrack?: (track: Track) => void;
  onEnqueueTrack?: (track: Track) => void;
  onPlayAlbum?: (tracks: Track[]) => void;
  onEnqueueAlbum?: (tracks: Track[]) => void;
  favoriteIds?: string[];
  onToggleFavorite?: (track: Track) => void;
  openRequest?: { item: CatalogItem; nonce: number };
  queryRequest?: { q: string; kind: CatalogKind; nonce: number };
  savedIds?: string[];
  onToggleSaved?: (item: CatalogItem) => void;
  onAddPlaylist?: (tracks: Track[]) => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind>('all');
  const [result, setResult] =
    useState<Awaited<ReturnType<typeof searchAcrossCatalog>>>();
  const [recent, setRecent] = useState(readRecentSearches);
  const updateRecent = (values: string[]) => {
    setRecent(values);
    saveRecentSearches(values);
  };
  const remember = () => updateRecent(rememberSearch(recent, query));
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [provider, setProvider] = useState<ProviderStatus>();
  const [selected, setSelected] = useState<CatalogItem>();
  const [details, setDetails] = useState<DetailResponse>();
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const [trail, setTrail] = useState<{ item: CatalogItem; scroll: number }[]>(
    [],
  );
  const resultsScroll = useRef(0);
  const pendingScroll = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    onDetailChange?.(Boolean(selected));
  }, [selected, onDetailChange]);
  useLayoutEffect(() => {
    if (
      active &&
      pendingScroll.current !== undefined &&
      (!selected || details || detailError)
    ) {
      window.scrollTo({ top: pendingScroll.current, behavior: 'instant' });
      pendingScroll.current = undefined;
    }
  }, [active, selected, details, detailError]);
  const selectItem = (item: CatalogItem) => {
    if (!selected) remember();
    if (selected)
      setTrail((items) => [
        ...items,
        { item: selected, scroll: window.scrollY },
      ]);
    else resultsScroll.current = window.scrollY;
    window.scrollTo({ top: 0, behavior: 'instant' });
    pendingScroll.current = 0;
    setDetails(undefined);
    setSelected(item);
  };
  useEffect(() => {
    if (openRequest) {
      setDetails(undefined);
      setSelected(openRequest.item);
      setTrail([]);
      resultsScroll.current = 0;
      pendingScroll.current = 0;
    }
  }, [openRequest]);
  useEffect(() => {
    if (queryRequest) {
      setQuery(queryRequest.q);
      setKind(queryRequest.kind);
      setSelected(undefined);
      setTrail([]);
      pendingScroll.current = 0;
    }
  }, [queryRequest]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    providerStatus(controller.signal)
      .then((data) =>
        setProvider(data.providers.find((item) => item.id === 'youtube')),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [active]);

  useEffect(() => {
    const controller = new AbortController();
    const value = query.trim();
    setResult(undefined);
    setError('');
    if (value.length < 2) {
      setStatus('idle');
      return () => controller.abort();
    }
    setStatus('loading');
    const timer = setTimeout(() => {
      searchAcrossCatalog(value, kind, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setResult(data);
          setStatus('ready');
          setProvider((current) =>
            current ? { ...current, state: 'available' } : current,
          );
        })
        .catch((failure: Error) => {
          if (controller.signal.aborted) return;
          setError(failure.message);
          setStatus('error');
          setProvider((current) =>
            current && current.state !== 'disabled'
              ? { ...current, state: 'degraded' }
              : current,
          );
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, kind, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setDetails(undefined);
    setDetailError('');
    if (selected)
      catalogDetails(selected.kind, selected.id, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setDetails(data);
        })
        .catch((failure: Error) => {
          if (!controller.signal.aborted) setDetailError(failure.message);
        });
    return () => controller.abort();
  }, [selected, detailRetry]);

  const item = details?.item ?? selected;
  const albumTracks =
    details?.item.tracks?.filter(
      (track) => track.kind === 'track' && track.playback.available,
    ) ?? [];
  const playableTracks =
    item?.kind === 'track' && item.playback.available
      ? [catalogItemToTrack(item)]
      : albumTracks.map(catalogItemToTrack);
  const detailActions: MenuAction[] = item
    ? [
        ...(playableTracks.length
          ? [
              {
                label:
                  item.kind === 'artist'
                    ? 'Accoda brani'
                    : item.kind === 'album'
                      ? 'Accoda album'
                      : 'Aggiungi alla coda',
                icon: 'queue' as const,
                onSelect: () => {
                  if (item.kind === 'track')
                    onEnqueueTrack?.(playableTracks[0]!);
                  else onEnqueueAlbum?.(playableTracks);
                },
              },
              {
                label: 'Aggiungi a playlist',
                icon: 'plus' as const,
                onSelect: () => onAddPlaylist?.(playableTracks),
              },
            ]
          : []),
        { label: 'Apri su YouTube Music', icon: 'arrow', href: item.sourceUrl },
      ]
    : [];
  return (
    <section className="catalog-panel" aria-label="Catalogo musicale">
      {item ? (
        <div className={`catalog-detail entity-${item.kind}`}>
          <button
            className="text-button"
            onClick={() => {
              setDetails(undefined);
              const previous = trail.at(-1);
              pendingScroll.current = previous?.scroll ?? resultsScroll.current;
              setSelected(previous?.item);
              setTrail((items) => items.slice(0, -1));
            }}
          >
            {trail.length ? '← Indietro' : '← Torna ai risultati'}
          </button>
          <div className="catalog-detail-heading">
            <Artwork item={item} />
            <div>
              <p className="eyebrow">
                {
                  { track: 'Brano', artist: 'Artista', album: 'Album' }[
                    item.kind
                  ]
                }
              </p>
              <h1>{item.title}</h1>
              {item.kind !== 'artist' && (
                <p className="entity-byline">{item.artist}</p>
              )}
              <p className="entity-meta">
                {item.kind === 'artist' ? (
                  'Brani, album e nuove scoperte'
                ) : (
                  <>
                    {item.kind === 'track' && item.album && (
                      <span>{item.album}</span>
                    )}
                    {item.year && <span>{item.year}</span>}
                    {item.kind === 'album' && details?.item.tracks && (
                      <span>{details.item.tracks.length} brani</span>
                    )}
                    {item.durationSeconds !== undefined && (
                      <span>
                        {Math.floor(item.durationSeconds / 60)}:
                        {String(Math.floor(item.durationSeconds % 60)).padStart(
                          2,
                          '0',
                        )}
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="detail-playback-actions">
            {playableTracks.length > 0 && (
              <button
                type="button"
                className="primary-play-btn"
                aria-label={
                  item.kind === 'artist'
                    ? 'Riproduci artista'
                    : item.kind === 'album'
                      ? 'Riproduci album'
                      : 'Riproduci ora'
                }
                onClick={() => {
                  if (item.kind === 'track') onPlayTrack?.(playableTracks[0]!);
                  else onPlayAlbum?.(playableTracks);
                }}
              >
                <Icon name="play" size={22} />
                Riproduci
              </button>
            )}
            {item.kind === 'track' &&
              item.playback.available &&
              onToggleFavorite && (
                <button
                  className="icon-button entity-favorite favorite-button"
                  aria-label={
                    favoriteIds.includes(item.id)
                      ? 'Rimuovi dai preferiti'
                      : 'Salva nei preferiti'
                  }
                  aria-pressed={favoriteIds.includes(item.id)}
                  onClick={() => onToggleFavorite(catalogItemToTrack(item))}
                >
                  <Icon name="heart" />
                </button>
              )}
            {item.kind !== 'track' && (
              <button
                className="secondary-btn entity-save"
                aria-pressed={savedIds.includes(item.id)}
                onClick={() => onToggleSaved?.(item)}
              >
                {item.kind === 'artist'
                  ? savedIds.includes(item.id)
                    ? 'Artista seguito'
                    : 'Segui artista'
                  : savedIds.includes(item.id)
                    ? 'Album salvato'
                    : 'Salva album'}
              </button>
            )}
            <ActionMenu
              label={`Altre opzioni per ${item.title}`}
              title={item.title}
              actions={detailActions}
            />
          </div>
          {item.kind === 'track' && !item.playback.available && (
            <p className="muted">Riproduzione non disponibile in MusicBit.</p>
          )}
          {!details && !detailError && (
            <p role="status">Caricamento dettagli…</p>
          )}
          {detailError && (
            <div className="banner error" role="alert">
              {detailError}{' '}
              <button onClick={() => setDetailRetry((value) => value + 1)}>
                Riprova dettagli
              </button>
            </div>
          )}
          {details?.item.tracks && (
            <div className="album-tracks-section">
              <h3>
                {item.kind === 'artist' ? 'Brani popolari' : 'Brani dell’album'}{' '}
                ({details.item.tracks.length})
              </h3>
              <ResultList
                items={details.item.tracks}
                select={selectItem}
                onPlayTrack={onPlayTrack}
                onEnqueueTrack={onEnqueueTrack}
              />
            </div>
          )}
          <CatalogShelf
            title="Discografia"
            items={details?.item.albums ?? []}
            onOpen={selectItem}
            onPlay={(track) => onPlayTrack?.(track)}
          />
          <CatalogShelf
            title="Artisti simili"
            items={details?.item.relatedArtists ?? []}
            onOpen={selectItem}
            onPlay={(track) => onPlayTrack?.(track)}
          />
          {item.artistId && item.kind !== 'artist' && (
            <button
              className="text-button"
              onClick={() =>
                selectItem({
                  ...item,
                  id: item.artistId!,
                  kind: 'artist',
                  title: item.artist,
                  sourceUrl: `https://music.youtube.com/channel/${item.artistId}`,
                  playback: { available: false },
                })
              }
            >
              Vai all’artista: {item.artist} <Icon name="arrow" size={16} />
            </button>
          )}
          {item.albumId && item.kind === 'track' && (
            <button
              className="text-button"
              onClick={() =>
                selectItem({
                  ...item,
                  id: item.albumId!,
                  kind: 'album',
                  title: item.album || 'Album',
                  sourceUrl: `https://music.youtube.com/browse/${item.albumId}`,
                  playback: { available: false },
                })
              }
            >
              Vai all’album: {item.album} <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      ) : (
        <>
          {provider && provider.state !== 'available' && (
            <p className="muted provider-state">
              {availability[provider.state]}
            </p>
          )}
          <form
            className="catalog-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              remember();
            }}
          >
            <label htmlFor="music-search">Cerca nel catalogo</label>
            <div className="catalog-input">
              <Icon name="search" />
              <input
                id="music-search"
                type="search"
                inputMode="search"
                autoComplete="off"
                maxLength={120}
                placeholder="Cerca brani, artisti o album…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Cancella ricerca"
                  onClick={() => setQuery('')}
                >
                  <Icon name="close" size={18} />
                </button>
              )}
            </div>
            <div
              className="catalog-filters"
              role="group"
              aria-label="Tipo di ricerca"
            >
              {(['all', 'track', 'artist', 'album'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={kind === type}
                  onClick={() => setKind(type)}
                >
                  {labels[type]}
                </button>
              ))}
            </div>
          </form>
          {status === 'idle' && recent.length > 0 && (
            <section className="recent-searches" aria-label="Ricerche recenti">
              <div className="section-heading">
                <h2>Ricerche recenti</h2>
                <button
                  className="text-button"
                  onClick={() => updateRecent([])}
                >
                  Cancella tutte
                </button>
              </div>
              <ul>
                {recent.map((value) => (
                  <li key={value}>
                    <button
                      className="recent-query"
                      onClick={() => {
                        setKind('all');
                        setQuery(value);
                      }}
                    >
                      <Icon name="search" size={18} />
                      <span>{value}</span>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Rimuovi ricerca ${value}`}
                      onClick={() =>
                        updateRecent(recent.filter((q) => q !== value))
                      }
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="catalog-feedback"
          >
            {status === 'idle' && (
              <p className="muted">Scrivi almeno due caratteri per cercare.</p>
            )}
            {status === 'loading' && <p role="status">Ricerca in corso…</p>}
            {status === 'ready' && (
              <p className="muted">
                {result?.items.length
                  ? `${result.items.length} ${result.items.length === 1 ? 'risultato' : 'risultati'}`
                  : 'Nessun risultato. Prova un altro nome.'}
              </p>
            )}
          </div>
          {status === 'error' && (
            <div className="banner error" role="alert">
              {error}{' '}
              <button onClick={() => setRetry((value) => value + 1)}>
                Riprova ricerca
              </button>
            </div>
          )}
          {!!result?.missingKinds.length && (
            <div className="banner" role="status">
              {result.missingKinds.map((key) => labels[key]).join(', ')}{' '}
              temporaneamente non disponibili.{' '}
              <button onClick={() => setRetry((value) => value + 1)}>
                Riprova categorie mancanti
              </button>
            </div>
          )}
          {result &&
            (kind === 'all' ? (
              (['track', 'artist', 'album'] as const).map((type) => {
                const items = result.items.filter((item) => item.kind === type);
                return (
                  items.length > 0 && (
                    <section
                      className="search-result-group"
                      key={type}
                      aria-label={`Risultati: ${labels[type]}`}
                    >
                      <div className="section-heading">
                        <h2>{labels[type]}</h2>
                        <button
                          className="text-button"
                          onClick={() => setKind(type)}
                        >
                          Vedi {labels[type].toLowerCase()}
                        </button>
                      </div>
                      <ResultList
                        items={items.slice(0, 5)}
                        select={selectItem}
                        onPlayTrack={(track) => {
                          remember();
                          onPlayTrack?.(track);
                        }}
                        onEnqueueTrack={onEnqueueTrack}
                      />
                    </section>
                  )
                );
              })
            ) : (
              <ResultList
                items={result.items}
                select={selectItem}
                onPlayTrack={(track) => {
                  remember();
                  onPlayTrack?.(track);
                }}
                onEnqueueTrack={onEnqueueTrack}
              />
            ))}
        </>
      )}
    </section>
  );
}
