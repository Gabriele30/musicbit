import { useEffect, useState } from 'react';
import type {
  CatalogItem,
  CatalogKind,
  DetailResponse,
  ProviderStatus,
  SearchResponse,
} from '@musicbit/shared';
import { catalogDetails, providerStatus, searchCatalog } from '../search-api';
import { Icon } from './Icon';

const labels: Record<CatalogKind, string> = {
  track: 'Brani',
  artist: 'Artisti',
  album: 'Album',
};
const availability: Record<ProviderStatus['state'], string> = {
  available: 'Ultima richiesta riuscita',
  unverified: 'Disponibilità da verificare',
  degraded: 'Ultima richiesta fallita',
  disabled: 'Provider disabilitato',
};

function Artwork({ item }: { item: CatalogItem }) {
  return item.artworkUrl ? (
    <img
      src={item.artworkUrl}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      width="64"
      height="64"
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  ) : (
    <span className="catalog-artwork-placeholder">
      <Icon name="music" />
    </span>
  );
}
function ResultList({
  items,
  select,
}: {
  items: CatalogItem[];
  select: (item: CatalogItem) => void;
}) {
  return (
    <ul className="catalog-results">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`}>
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
              <span className="catalog-only">
                Solo catalogo · {labels[item.kind]}
              </span>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Search() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CatalogKind>('track');
  const [result, setResult] = useState<SearchResponse>();
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

  useEffect(() => {
    const controller = new AbortController();
    providerStatus(controller.signal)
      .then((data) =>
        setProvider(data.providers.find((item) => item.id === 'youtube')),
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);

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
      searchCatalog(value, kind, controller.signal)
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
  return (
    <section className="catalog-panel" aria-label="Catalogo musicale">
      <div className="catalog-disclosure">
        <p className="eyebrow">YOUTUBE MUSIC / METADATI</p>
        <p>
          Esplora brani, artisti e album. Questi risultati sono{' '}
          <strong>solo catalogo</strong>: non hanno uno stream autorizzato
          disponibile in MusicBit. Le tracce demo restano nel Player.
        </p>
        <small>
          {provider
            ? availability[provider.state]
            : 'Stato provider non disponibile'}{' '}
          · API non ufficiale
        </small>
      </div>
      {item ? (
        <div className="catalog-detail">
          <button
            className="text-button"
            onClick={() => setSelected(undefined)}
          >
            ← Torna ai risultati
          </button>
          <div className="catalog-detail-heading">
            <Artwork item={item} />
            <div>
              <p className="eyebrow">{labels[item.kind]} · solo catalogo</p>
              <h2>{item.title}</h2>
              <p className="muted">{item.artist}</p>
            </div>
          </div>
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
          {details && (
            <dl className="catalog-facts">
              <div>
                <dt>Provider</dt>
                <dd>YouTube Music</dd>
              </div>
              {item.album && (
                <div>
                  <dt>Album</dt>
                  <dd>{item.album}</dd>
                </div>
              )}
              {item.year && (
                <div>
                  <dt>Anno</dt>
                  <dd>{item.year}</dd>
                </div>
              )}
              {item.durationSeconds !== undefined && (
                <div>
                  <dt>Durata</dt>
                  <dd>
                    {Math.floor(item.durationSeconds / 60)}:
                    {String(Math.floor(item.durationSeconds % 60)).padStart(
                      2,
                      '0',
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <p className="catalog-only">
            Riproduzione non disponibile in MusicBit.
          </p>
          <a
            className="catalog-source"
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Apri su YouTube Music <Icon name="arrow" size={16} />
          </a>
          {details?.item.tracks && (
            <div>
              <h3>Brani dell’album · solo metadati</h3>
              <ResultList items={details.item.tracks} select={setSelected} />
            </div>
          )}
        </div>
      ) : (
        <>
          <form
            className="catalog-search"
            role="search"
            onSubmit={(event) => event.preventDefault()}
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
                placeholder="Un brano, un artista, un album…"
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
              {(['track', 'artist', 'album'] as const).map((type) => (
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
          <div
            aria-live="polite"
            aria-atomic="true"
            className="catalog-feedback"
          >
            {status === 'idle' && (
              <p className="muted">Scrivi almeno due caratteri per iniziare.</p>
            )}
            {status === 'loading' && <p role="status">Ricerca in corso…</p>}
            {status === 'ready' && (
              <p className="muted">
                {result?.items.length
                  ? `${result.items.length} ${result.items.length === 1 ? 'risultato' : 'risultati'}`
                  : 'Nessun risultato. Prova un altro nome.'}
                {result && (
                  <small className="catalog-timing">
                    API {result.timing.elapsedMs.toFixed(0)} ms · cache{' '}
                    {result.timing.cache}
                  </small>
                )}
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
          {result && <ResultList items={result.items} select={setSelected} />}
        </>
      )}
    </section>
  );
}
