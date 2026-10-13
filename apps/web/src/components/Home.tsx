import { useEffect, useState } from 'react';
import {
  catalogItemToTrack,
  type CatalogItem,
  type CatalogKind,
  type FeedResponse,
  type Track,
  personalRecommendations,
  isCatalogItem,
  automaticMixes,
} from '@musicbit/shared';
import { accountRequest } from '../account';
import { homeFeed } from '../search-api';
import type { LibraryModel } from '../library';
import { Icon } from './Icon';
import { CoverArt } from './CoverArt';
import { useAudioWarmup } from '../player/use-audio-warmup';
import { quickPicks } from '../home-personalization';
import { Charts } from './Charts';

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
  accountId,
  syncStatus,
  onPlayAll,
  onWrapped,
  onAiPlaylist,
  onTasteProfile,
}: {
  active: boolean;
  library: LibraryModel;
  suggestions: Track[];
  onOpen: (item: CatalogItem) => void;
  onPlay: (track: Track) => void;
  onSearch: (q?: string, kind?: CatalogKind) => void;
  onLibrary: () => void;
  onPlaylist: (id: string) => void;
  accountId?: string;
  syncStatus?: string;
  onPlayAll?: (tracks: Track[]) => void;
  onWrapped?: () => void;
  onAiPlaylist?: () => void;
  onTasteProfile?: () => void;
}) {
  const [feed, setFeed] = useState<FeedResponse>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState<CatalogKind | 'all'>('all');
  const [artistDiscovery, setArtistDiscovery] = useState<{
    artists: CatalogItem[];
    basedOn: string[];
    source: string;
    pending?: boolean;
  }>();
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState(false);
  const profileKey = JSON.stringify([
    library.history.slice(0, 20).map((h) => h.track.id),
    library.favorites.map((t) => t.id),
    library.followedArtists.map((a) => a.id),
    library.snapshot.taste?.artistPreferences,
  ]);
  const picks = quickPicks(library.snapshot);
  const [personalCandidates, setPersonalCandidates] = useState<CatalogItem[]>(
    [],
  );
  useEffect(() => {
    if (!active || !accountId || syncStatus !== 'saved') return;
    const controller = new AbortController();
    void accountRequest<{ items: { item: CatalogItem }[] }>(
      '/api/me/recommendations',
      undefined,
      'GET',
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setPersonalCandidates(
            data.items.map((v) => v.item).filter(isCatalogItem),
          );
      })
      .catch(() => {
        /* The normal feed and locally ranked suggestions remain usable. */
      });
    return () => controller.abort();
  }, [active, accountId, syncStatus, refresh, profileKey]);
  useEffect(() => {
    if (!active || !accountId || syncStatus !== 'saved') return;
    const controller = new AbortController();
    setDiscoveryLoading(true);
    setDiscoveryError(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      void accountRequest<{
        artists: CatalogItem[];
        basedOn: string[];
        source: string;
        pending?: boolean;
      }>(
        '/api/me/discovery/artists',
        undefined,
        'GET',
        controller.signal,
        40000,
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setArtistDiscovery({
              ...data,
              artists: data.artists.filter(
                (i) => isCatalogItem(i) && i.kind === 'artist',
              ),
            });
          if (!controller.signal.aborted && data.pending)
            timer = setTimeout(update, 15000);
        })
        .catch(() => {
          if (!controller.signal.aborted) setDiscoveryError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setDiscoveryLoading(false);
        });
    };
    update();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, accountId, syncStatus, refresh, profileKey]);
  const hasListeningProfile =
    library.favorites.length > 0 ||
    library.followedArtists.length > 0 ||
    library.history.length > 0;
  const personal = hasListeningProfile
    ? personalRecommendations(library.snapshot, [
        ...personalCandidates,
        ...(feed?.sections.flatMap((s) => s.items) ?? []),
      ])
    : [];
  const mixes = hasListeningProfile
    ? automaticMixes(library.snapshot, [
        ...personalCandidates,
        ...(feed?.sections.flatMap((s) => s.items) ?? []),
      ])
    : [];
  const [mixNotice, setMixNotice] = useState('');
  const firstFeedTrack = (
    feed?.sections.flatMap((section) => section.items) ?? []
  ).find((item) => item.kind === 'track' && item.playback.available);
  useAudioWarmup(
    (filter === 'all' ? library.history[0]?.track.audioUrl : undefined) ??
      (firstFeedTrack
        ? catalogItemToTrack(firstFeedTrack).audioUrl
        : undefined),
    active && (filter === 'all' || filter === 'track'),
  );
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
          <div className="experience-shortcuts">
            <button onClick={onWrapped}>
              <Icon name="pulse" />
              <span>
                <strong>Il tuo Wrapped</strong>
                <small>Il tuo anno, ogni giorno</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            <button onClick={onAiPlaylist}>
              <Icon name="music" />
              <span>
                <strong>Crea con AI</strong>
                <small>Descrivi la tua prossima playlist</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
            <button onClick={onTasteProfile}>
              <Icon name="settings" />
              <span>
                <strong>Taste Profile</strong>
                <small>Affina ciò che ti rappresenta</small>
              </span>
              <Icon name="arrow" size={18} />
            </button>
          </div>
          {!!mixes.length && (
            <section className="feed-section automatic-mixes">
              <div className="section-heading">
                <h2>Mix che cambiano con te</h2>
                <span className="muted">Aggiornati dai tuoi ascolti</span>
              </div>
              <div className="mix-grid">
                {mixes.map((mix, i) => (
                  <article key={mix.id} className={`mix-card mix-${i}`}>
                    <div className="mix-art">
                      <Icon
                        name={
                          i === 0 ? 'music' : i === 1 ? 'repeat' : 'shuffle'
                        }
                        size={36}
                      />
                      <span>MUSICBIT MIX</span>
                    </div>
                    <h3>{mix.name}</h3>
                    <p>{mix.description}</p>
                    <small>{mix.tracks.length} brani</small>
                    <div className="profile-actions">
                      <button
                        className="primary-play-btn"
                        aria-label={`Riproduci ${mix.name}`}
                        onClick={() => onPlayAll?.(mix.tracks)}
                      >
                        <Icon name="play" size={18} />
                        Ascolta
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          const id = library.createPlaylist(
                            mix.name,
                            mix.tracks,
                          );
                          setMixNotice(
                            id
                              ? `${mix.name} salvato come playlist modificabile.`
                              : 'Impossibile salvare: limite della libreria raggiunto.',
                          );
                        }}
                      >
                        Salva mix
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {mixNotice && <p role="status">{mixNotice}</p>}
            </section>
          )}
          {!!personal.length && (
            <section className="feed-section personal-section">
              <div className="section-heading">
                <h2>Scelti per te</h2>
                <span className="muted">Dai tuoi ascolti e preferiti</span>
              </div>
              <div className="personal-grid">
                {personal.slice(0, 4).map(({ item, reason }) => (
                  <article key={item.id} className="personal-track">
                    <button
                      className="personal-play"
                      onClick={() => onPlay(catalogItemToTrack(item))}
                      aria-label={`Riproduci ${item.title}`}
                    >
                      <CoverArt src={item.artworkUrl} title={item.title} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.artist}</small>
                        <small className="recommendation-reason">
                          {reason}
                        </small>
                      </span>
                      <Icon name="play" size={18} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => library.dismissTrack(item.id)}
                      aria-label={`Meno come ${item.title}`}
                    >
                      Meno come questo
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
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
      {(filter === 'all' || filter === 'track') && (
        <section aria-label="Le tue scelte veloci">
          <TrackShelf title="Scelte veloci" tracks={picks} onPlay={onPlay} />
          {!picks.length && (
            <p className="muted">
              Le scelte veloci si riempiono con i brani che ascolti e salvi.
            </p>
          )}
        </section>
      )}
      {(filter === 'all' || filter === 'artist') &&
        hasListeningProfile &&
        accountId && (
          <section
            className="feed-section"
            aria-label="Scoperta artisti personalizzata"
          >
            <CatalogShelf
              title="Artisti da scoprire"
              items={artistDiscovery?.artists ?? []}
              onOpen={onOpen}
              onPlay={onPlay}
            />
            {artistDiscovery?.artists.length ? (
              <p className="muted">
                {artistDiscovery.source === 'ai'
                  ? 'Suggeriti dall’AI e verificati nel catalogo'
                  : 'Artisti correlati ai tuoi ascolti'}{' '}
                · Da {artistDiscovery.basedOn.slice(0, 3).join(', ')}
                {artistDiscovery.pending &&
                  ' · L’AI sta affinando i suggerimenti…'}
              </p>
            ) : (
              <p className="muted" role="status">
                {discoveryLoading
                  ? 'Cerchiamo nuovi artisti dai tuoi ascolti…'
                  : discoveryError
                    ? 'Scoperta artisti non disponibile. Tocca Aggiorna feed per riprovare.'
                    : 'Continua ad ascoltare per trovare nuovi artisti affini.'}
              </p>
            )}
          </section>
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
      {feed?.sections
        .filter(
          (section) =>
            !/^(Scelte veloci|Quick picks)$/i.test(section.title) &&
            !(
              hasListeningProfile &&
              accountId &&
              (section.id === 'discover-artist' ||
                section.title === 'Artisti da scoprire')
            ),
        )
        .map((section) => (
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
      {(filter === 'all' || filter === 'track') && (
        <Charts
          active={active}
          onSearch={(query) => onSearch(query, 'track')}
        />
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
