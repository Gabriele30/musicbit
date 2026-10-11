import { useEffect, useState } from 'react';
import {
  catalogItemToTrack,
  type CatalogItem,
  type CatalogKind,
  type FeedResponse,
  type Track,
} from '@musicbit/shared';
import { homeFeed } from '../search-api';
import type { LibraryModel } from '../library';
import { Icon } from './Icon';
import { CoverArt } from './CoverArt';

export function CatalogShelf({
  title,
  items,
  onOpen,
  onPlay,
}: {
  title: string;
  items: CatalogItem[];
  onOpen: (item: CatalogItem) => void;
  onPlay: (track: Track) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="feed-section" aria-label={title}>
      <h2>{title}</h2>
      <div className="music-shelf">
        {items.map((item) => (
          <article
            key={`${item.kind}:${item.id}`}
            className={`music-card ${item.kind}`}
          >
            <button
              className="music-card-main"
              onClick={() => onOpen(item)}
              aria-label={`${item.kind === 'track' ? 'Dettagli' : 'Apri'} ${item.title}`}
            >
              <CoverArt
                className="music-card-art"
                src={item.artworkUrl}
                title={item.title}
                artist={item.kind === 'artist'}
              />
              <strong>{item.title}</strong>
              <small>{item.kind === 'artist' ? 'Artista' : item.artist}</small>
            </button>
            {item.kind === 'track' && item.playback.available && (
              <button
                className="card-play"
                onClick={() => onPlay(catalogItemToTrack(item))}
                aria-label={`Riproduci ${item.title}`}
              >
                <Icon name="play" size={20} />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function TrackShelf({
  title,
  tracks,
  onPlay,
}: {
  title: string;
  tracks: Track[];
  onPlay: (track: Track) => void;
}) {
  if (!tracks.length) return null;
  return (
    <section className="feed-section">
      <h2>{title}</h2>
      <div className="quick-list">
        {tracks.slice(0, 8).map((track) => (
          <button
            key={track.id}
            onClick={() => onPlay(track)}
            aria-label={`Riascolta ${track.title}`}
          >
            <CoverArt src={track.artworkUrl} title={track.title} />
            <span>
              <strong>{track.title}</strong>
              <small>{track.artist}</small>
            </span>
            <Icon name="play" size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}
export function Home({
  active,
  library,
  suggestions,
  onOpen,
  onPlay,
  onSearch,
  onLibrary,
  onPlaylist,
}: {
  active: boolean;
  library: LibraryModel;
  suggestions: Track[];
  onOpen: (item: CatalogItem) => void;
  onPlay: (track: Track) => void;
  onSearch: (q?: string, kind?: CatalogKind) => void;
  onLibrary: () => void;
  onPlaylist: (id: string) => void;
}) {
  const [feed, setFeed] = useState<FeedResponse>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<CatalogKind | 'all'>('all');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError('');
    void homeFeed(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFeed(data);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [active, refresh]);
  return (
    <div className="home-feed">
      <div
        className="catalog-filters home-filters"
        role="group"
        aria-label="Filtra il feed"
      >
        {(['all', 'track', 'album', 'artist'] as const).map((kind) => (
          <button
            key={kind}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {
              {
                all: 'Tutto',
                track: 'Brani',
                album: 'Album',
                artist: 'Artisti',
              }[kind]
            }
          </button>
        ))}
        <button
          className="feed-refresh"
          aria-label="Aggiorna feed"
          title="Aggiorna feed"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>
      {filter === 'all' && (
        <>
          <TrackShelf
            title="Ascoltati di recente"
            tracks={library.history.map((entry) => entry.track)}
            onPlay={onPlay}
          />
          {!!library.playlists.length && (
            <section className="feed-section">
              <div className="section-heading">
                <h2>Le tue playlist</h2>
                <button className="text-button" onClick={onLibrary}>
                  Vedi tutte
                </button>
              </div>
              <div className="playlist-shortcuts">
                {library.playlists.slice(0, 6).map((list) => (
                  <button key={list.id} onClick={() => onPlaylist(list.id)}>
                    <CoverArt
                      className="playlist-cover"
                      src={list.tracks[0]?.artworkUrl}
                      title={list.name}
                    />
                    <strong>{list.name}</strong>
                    <small>{list.tracks.length} brani</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          <TrackShelf
            title="Continua a scoprire"
            tracks={suggestions}
            onPlay={onPlay}
          />
        </>
      )}
      {(filter === 'all' || filter === 'artist') && (
        <CatalogShelf
          title="Gli artisti che segui"
          items={library.followedArtists}
          onOpen={onOpen}
          onPlay={onPlay}
        />
      )}
      {(filter === 'all' || filter === 'album') && (
        <CatalogShelf
          title="I tuoi album"
          items={library.savedAlbums}
          onOpen={onOpen}
          onPlay={onPlay}
        />
      )}
      {!feed && !error && (
        <div className="feed-loading" role="status">
          Prepariamo la tua musica…
          <div className="skeleton-shelf" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}{' '}
          <button onClick={() => setRefresh((value) => value + 1)}>
            Riprova feed
          </button>
        </div>
      )}
      {feed?.sections.map((section) => (
        <CatalogShelf
          key={section.id}
          title={section.title}
          items={section.items.filter(
            (item) => filter === 'all' || item.kind === filter,
          )}
          onOpen={onOpen}
          onPlay={onPlay}
        />
      ))}
      {feed &&
        !feed.sections.some((section) =>
          section.items.some(
            (item) => filter === 'all' || item.kind === filter,
          ),
        ) && (
          <p className="muted">
            Nessun suggerimento disponibile in questa categoria. Cerca un
            artista o esplora un genere.
          </p>
        )}
      <section className="feed-section">
        <h2>Segui il tuo umore</h2>
        <div className="genre-grid">
          {[
            'Pop italiano',
            'Indie',
            'Hip hop',
            'Elettronica',
            'Jazz',
            'Relax',
          ].map((genre, index) => (
            <button
              key={genre}
              className={`genre genre-${index}`}
              onClick={() => onSearch(genre, 'track')}
            >
              {genre}
              <Icon name="arrow" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
