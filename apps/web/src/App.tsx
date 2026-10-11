import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  type Track,
  type CatalogItem,
  type CatalogKind,
} from '@musicbit/shared';
import { loadCatalog } from './catalog';
import { PlayerEngine } from './player/engine';
import { Icon, type IconName } from './components/Icon';
import { Diagnostics } from './components/Diagnostics';
import { PwaNotice } from './components/PwaNotice';
import { Search } from './components/Search';
import {
  CollectionLibrary,
  type LibraryTab,
} from './components/CollectionLibrary';
import { Home } from './components/Home';
import { PlaylistPicker } from './components/PlaylistPicker';
import { ActionMenu } from './components/ActionMenu';
import { CoverArt } from './components/CoverArt';
import { useLibrary } from './library';

type Screen =
  | 'home'
  | 'player'
  | 'search'
  | 'library'
  | 'queue'
  | 'diagnostics';
const screens: { id: Screen; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'search', label: 'Cerca', icon: 'search' },
  { id: 'library', label: 'Libreria', icon: 'library' },
];
const isPrimaryScreen = (value: Screen) =>
  screens.some((item) => item.id === value);
export const formatTime = (seconds: number) => {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(value / 60)}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;
};
const readScreen = (): Screen => {
  const value = new URLSearchParams(location.search).get('screen');
  return value === 'diagnostics' ||
    value === 'search' ||
    value === 'queue' ||
    value === 'library'
    ? value
    : value === 'player'
      ? 'player'
      : 'home';
};

export function App({ player }: { player: PlayerEngine }) {
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const library = useLibrary();
  const { favorites, toggleFavorite, recordHistory, storageError } = library;
  const [openRequest, setOpenRequest] = useState<{
    item: CatalogItem;
    nonce: number;
  }>();
  const [queryRequest, setQueryRequest] = useState<{
    q: string;
    kind: CatalogKind;
    nonce: number;
  }>();
  const [playlistId, setPlaylistId] = useState<string>();
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>();
  const [catalogDetailOpen, setCatalogDetailOpen] = useState(false);
  const [screen, updateScreen] = useState<Screen>(readScreen);
  const [primaryScreen, setPrimaryScreen] = useState<Screen>(() =>
    isPrimaryScreen(readScreen()) ? readScreen() : 'home',
  );
  const scrollPositions = useRef<Partial<Record<Screen, number>>>({});
  const main = useRef<HTMLElement>(null);
  const demoMode = new URLSearchParams(location.search).get('demo') === '1';
  const needsDemoCatalog = demoMode || screen === 'diagnostics';
  const setScreen = (value: Screen) => {
    if (value === screen) return;
    scrollPositions.current[screen] = window.scrollY;
    const url = new URL(location.href);
    if (value === 'home') url.searchParams.delete('screen');
    else url.searchParams.set('screen', value);
    const primary = isPrimaryScreen(value) ? value : primaryScreen;
    history.pushState(
      { musicbitOverlay: !isPrimaryScreen(value), primary },
      '',
      url,
    );
    setPrimaryScreen(primary);
    updateScreen(value);
  };
  const closeScreen = () => {
    if (history.state?.musicbitOverlay) history.back();
    else setScreen(primaryScreen);
  };
  useLayoutEffect(() => {
    window.scrollTo({
      top: scrollPositions.current[screen] ?? 0,
      behavior: 'instant',
    });
    main.current?.focus({ preventScroll: true });
  }, [screen]);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const current = state.queue[state.index];
  const active = state.status === 'playing' || state.status === 'loading';
  const repeatLabel = {
    off: 'disattivata',
    all: 'tutta la coda',
    one: 'un brano',
  }[state.repeat];
  useEffect(() => {
    if (state.status === 'playing' && current) recordHistory(current);
    // A history entry records an actual start/resume, not each timeupdate.
  }, [current, state.status, recordHistory]);
  const openItem = (item: CatalogItem) => {
    setOpenRequest({ item, nonce: Date.now() });
    setScreen('search');
  };
  const searchFor = (q = '', kind: CatalogKind = 'track') => {
    setQueryRequest({ q, kind, nonce: Date.now() });
    setScreen('search');
  };

  useEffect(() => {
    const back = () => {
      scrollPositions.current[screen] = window.scrollY;
      const next = readScreen();
      if (isPrimaryScreen(next)) setPrimaryScreen(next);
      else if (history.state?.primary)
        setPrimaryScreen(history.state.primary as Screen);
      updateScreen(next);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [screen]);

  useEffect(() => {
    if (!needsDemoCatalog) return;
    const controller = new AbortController();
    loadCatalog(controller.signal, (timing) => player.recordCatalog(timing))
      .then((data) => {
        if (controller.signal.aborted) return;
        setTracks(data.tracks);
        setCatalogStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogStatus('error');
      });
    return () => controller.abort();
  }, [player, reload, needsDemoCatalog]);
  useEffect(() => {
    if (screen === 'diagnostics' || (screen === 'player' && demoMode))
      player.setCatalog(tracks);
  }, [player, screen, tracks, demoMode]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  const toggle = () => {
    if (active) player.pause();
    else player.play();
  };
  const playTrack = (track: Track) => {
    const index = state.queue.findIndex((item) => item.id === track.id);
    if (index >= 0) player.select(index);
    else {
      player.enqueue(track);
      player.select(state.queue.length);
    }
  };
  const enqueueTrack = (track: Track) => {
    player.enqueue(track);
    setNotice(`"${track.title}" aggiunta alla coda`);
  };
  const playAlbum = (albumTracks: Track[]) => {
    if (!albumTracks.length) return;
    player.playCollection(albumTracks);
    setNotice(`Riproduzione avviata (${albumTracks.length} brani)`);
  };

  return (
    <div
      className={`app-shell screen-${screen} ${screen !== 'player' && current ? 'has-mini-player' : ''}`}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="MusicBit home"
          onClick={(event) => {
            event.preventDefault();
            setScreen('home');
          }}
        >
          <span className="brand-mark">
            <Icon name="music" />
          </span>
          MusicBit<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-body">
          <p className="nav-heading">IL TUO SPAZIO</p>
          <nav aria-label="Navigazione principale">
            {screens.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${primaryScreen === item.id ? 'selected' : ''}`}
                aria-current={primaryScreen === item.id ? 'page' : undefined}
                onClick={() => setScreen(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <Icon name="music" size={18} />
          Il tuo spazio musicale.
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          {!isPrimaryScreen(screen) ? (
            <button
              className="icon-button"
              aria-label={
                screen === 'queue'
                  ? 'Chiudi coda'
                  : screen === 'player'
                    ? 'Chiudi player'
                    : 'Chiudi diagnostica'
              }
              onClick={closeScreen}
            >
              <Icon name="down" />
            </button>
          ) : (
            <a
              className="topbar-brand"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                setScreen('home');
              }}
            >
              <span className="brand-mark">
                <Icon name="music" size={20} />
              </span>{' '}
              MusicBit<span className="brand-dot">.</span>
            </a>
          )}
          <span className="topbar-context">
            {screen === 'player'
              ? 'In ascolto'
              : screen === 'queue'
                ? 'La tua coda'
                : (screens.find((item) => item.id === screen)?.label ??
                  'Diagnostica')}
          </span>
          <div className="topbar-actions">
            {screen === 'player' && current && (
              <button
                className="icon-button"
                aria-label="Coda"
                onClick={() => setScreen('queue')}
              >
                <Icon name="queue" size={20} />
              </button>
            )}
            {screen !== 'search' && screen !== 'player' && (
              <button
                className="icon-button"
                aria-label="Cerca musica"
                onClick={() => searchFor()}
              >
                <Icon name="search" size={20} />
              </button>
            )}
            <ActionMenu
              label="Impostazioni"
              title="Il tuo spazio"
              icon="settings"
              actions={[
                ...(current
                  ? [
                      {
                        label: 'Apri player',
                        icon: 'music' as const,
                        onSelect: () => setScreen('player'),
                      },
                      {
                        label: 'Apri coda',
                        icon: 'queue' as const,
                        onSelect: () => setScreen('queue'),
                      },
                    ]
                  : []),
                {
                  label: 'Diagnostica',
                  icon: 'pulse',
                  onSelect: () => setScreen('diagnostics'),
                },
              ]}
            />
          </div>
        </header>
        <main id="main" ref={main} tabIndex={-1}>
          {screen !== 'player' &&
            !(screen === 'search' && catalogDetailOpen) && (
              <div
                className={`page-heading ${screen === 'search' ? 'search-page-heading' : ''}`}
              >
                <div>
                  <h1>
                    {screen === 'home'
                      ? 'Buon ascolto.'
                      : screen === 'search'
                        ? 'Cerca'
                        : screen === 'library'
                          ? 'Libreria'
                          : screen === 'queue'
                            ? 'A seguire'
                            : 'Diagnostica audio'}
                  </h1>
                </div>
              </div>
            )}
          {!online && (
            <p className="banner" role="status">
              Sei offline. L’interfaccia resta disponibile; catalogo e nuove
              tracce richiedono rete.
            </p>
          )}
          {storageError && (
            <p className="banner error" role="alert">
              {storageError}
            </p>
          )}
          {(screen === 'diagnostics' || demoMode) &&
            catalogStatus === 'loading' && (
              <p className="banner" role="status">
                Caricamento della libreria…
              </p>
            )}
          {(screen === 'diagnostics' || demoMode) &&
            catalogStatus === 'error' && (
              <div className="banner error" role="alert">
                Impossibile caricare la libreria. Verifica che l’API sia
                avviata.{' '}
                <button
                  onClick={() => {
                    setCatalogStatus('loading');
                    setReload((value) => value + 1);
                  }}
                >
                  Riprova catalogo
                </button>
              </div>
            )}
          <div hidden={screen !== 'home'}>
            <Home
              active={screen === 'home'}
              library={library}
              suggestions={state.autoplayTracks}
              onOpen={openItem}
              onPlay={playTrack}
              onSearch={searchFor}
              onLibrary={() => {
                setPlaylistId(undefined);
                setLibraryTab('playlists');
                setScreen('library');
              }}
              onPlaylist={(id) => {
                setPlaylistId(id);
                setScreen('library');
              }}
            />
          </div>
          {screen === 'player' && !current && (
            <section className="player-empty library-empty">
              <Icon name="music" size={44} />
              <h1>Il tuo prossimo ascolto ti aspetta</h1>
              <p>Cerca un brano o scegli qualcosa dalla Home.</p>
              <button className="primary-play-btn" onClick={() => searchFor()}>
                <Icon name="search" size={20} /> Cerca musica
              </button>
            </section>
          )}
          {screen === 'player' && current && (
            <div className="player-grid">
              <section className="now-playing" aria-label="In riproduzione">
                <div className="section-heading">
                  <p className="eyebrow">{current.album || 'IN ASCOLTO'}</p>
                  <span className="small-label">
                    {current
                      ? `${String(state.index + 1).padStart(2, '0')} / ${String(state.queue.length).padStart(2, '0')}`
                      : '—'}
                  </span>
                </div>
                <div
                  className={`artwork-wrap ${state.status === 'playing' ? 'is-playing' : ''}`}
                >
                  <CoverArt
                    className="hero-artwork"
                    src={current.artworkUrl}
                    title={current.title}
                    eager
                  />
                </div>
                <div className="track-heading">
                  <div>
                    <h1>{current.title}</h1>
                    <p>{current.artist}</p>
                  </div>
                  <span
                    className={`equalizer ${state.status === 'playing' ? 'moving' : ''}`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <div className="progress">
                  <input
                    aria-label="Posizione nella traccia"
                    type="range"
                    min="0"
                    max={state.duration || 1}
                    step="0.1"
                    value={Math.min(state.position, state.duration || 1)}
                    disabled={!state.duration}
                    onChange={(event) =>
                      player.seek(Number(event.target.value))
                    }
                  />
                  <div>
                    <span>{formatTime(state.position)}</span>
                    <span>
                      {state.duration ? formatTime(state.duration) : '—:—'}
                    </span>
                  </div>
                </div>
                <div className="transport">
                  <button
                    className="icon-button"
                    aria-label="Traccia precedente"
                    disabled={
                      !current ||
                      (state.index === 0 &&
                        state.position <= 3 &&
                        state.repeat !== 'all')
                    }
                    onClick={() => player.previous()}
                  >
                    <Icon name="previous" size={26} />
                  </button>
                  <button
                    className="play-button"
                    aria-label={active ? 'Pausa' : 'Play'}
                    disabled={!current}
                    onClick={toggle}
                  >
                    <Icon name={active ? 'pause' : 'play'} size={30} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Traccia successiva"
                    disabled={
                      !current ||
                      (state.index >= state.queue.length - 1 &&
                        state.repeat !== 'all' &&
                        !state.autoplayTracks.length)
                    }
                    onClick={() => player.next()}
                  >
                    <Icon name="next" size={26} />
                  </button>
                </div>
                <div className="session-controls">
                  {current && (
                    <button
                      className="text-button favorite-button"
                      aria-label={`${favorites.some((track) => track.id === current.id) ? 'Rimuovi' : 'Salva'} ${current.title} ${favorites.some((track) => track.id === current.id) ? 'dai' : 'nei'} preferiti`}
                      aria-pressed={favorites.some(
                        (track) => track.id === current.id,
                      )}
                      onClick={() => toggleFavorite(current)}
                    >
                      <Icon name="heart" size={18} />{' '}
                      <span className="favorite-label">Preferito</span>
                    </button>
                  )}
                  <button
                    className="text-button"
                    aria-label={`Ripetizione: ${repeatLabel}`}
                    aria-pressed={state.repeat !== 'off'}
                    onClick={() => player.cycleRepeat()}
                  >
                    <Icon name="repeat" size={18} />
                    {state.repeat === 'one'
                      ? 'Ripeti brano'
                      : state.repeat === 'all'
                        ? 'Ripeti coda'
                        : 'Ripeti'}
                  </button>
                  {current && (
                    <button
                      className="text-button"
                      aria-label="Aggiungi il brano a una playlist"
                      onClick={() => setPlaylistTracks([current])}
                    >
                      <Icon name="plus" size={18} />
                      <span className="favorite-label">Playlist</span>
                    </button>
                  )}
                </div>
                <p className="playback-label" role="status">
                  {state.status === 'loading'
                    ? 'Caricamento audio…'
                    : state.status === 'playing'
                      ? 'In riproduzione'
                      : state.status === 'paused'
                        ? 'In pausa'
                        : state.status === 'ended'
                          ? 'Sessione conclusa'
                          : state.status === 'error'
                            ? 'Audio non disponibile'
                            : 'Pronto quando vuoi'}
                </p>
              </section>
              <div className="library-column">
                {demoMode && (
                  <section className="library" aria-labelledby="library-title">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">LA TUA LIBRERIA</p>
                        <h2 id="library-title">Demo sessions</h2>
                      </div>
                      <span className="small-label">
                        {tracks.length} tracce
                      </span>
                    </div>
                    <p className="muted library-intro">
                      Un piccolo viaggio nella musica generativa.
                    </p>
                    <ol className="track-list">
                      {tracks.map((track, i) => (
                        <li
                          key={track.id}
                          className={
                            current?.id === track.id ? 'current-track' : ''
                          }
                        >
                          <button
                            className="track-select"
                            aria-label={`Riproduci ${track.title}`}
                            onClick={() => playTrack(track)}
                          >
                            <span className="track-number">
                              {current?.id === track.id &&
                              state.status === 'playing' ? (
                                <Icon name="music" size={17} />
                              ) : (
                                `0${i + 1}`
                              )}
                            </span>
                            <img
                              src={track.artworkUrl}
                              alt=""
                              width="56"
                              height="56"
                            />
                            <span className="track-copy">
                              <strong>{track.title}</strong>
                              <small>{track.artist}</small>
                            </span>
                          </button>
                          <button
                            className="icon-button add-button"
                            aria-label={`Aggiungi ${track.title} alla coda`}
                            onClick={() => {
                              player.enqueue(track);
                              setNotice(`${track.title} aggiunta alla coda`);
                            }}
                          >
                            <Icon name="plus" size={19} />
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className="library-bottom">
                      <span>MP3 · sorgenti autorizzate</span>
                      <Icon name="music" size={16} />
                    </div>
                  </section>
                )}
                <section className="next-card">
                  <div>
                    <p className="eyebrow">A SEGUIRE</p>
                    <h3>
                      {state.queue[state.index + 1]?.title ??
                        state.autoplayTracks[0]?.title ??
                        'Scegli il prossimo brano'}
                    </h3>
                    <p className="muted">
                      {state.queue[state.index + 1]?.artist ??
                        state.autoplayTracks[0]?.artist ??
                        'Esplora la tua musica o attiva i suggerimenti.'}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Apri coda"
                    onClick={() => setScreen('queue')}
                  >
                    <Icon name="arrow" />
                  </button>
                </section>
              </div>
            </div>
          )}
          {screen === 'queue' && (
            <section className="queue-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LA SESSIONE</p>
                  <h2>Coda di riproduzione</h2>
                </div>
                <span className="small-label">{state.queue.length} tracce</span>
              </div>
              <p className="muted">
                {state.repeat === 'off'
                  ? state.autoplay
                    ? 'Al termine della coda continuano i brani suggeriti.'
                    : 'La coda termina dopo l’ultima traccia.'
                  : state.repeat === 'one'
                    ? 'Il brano corrente si ripete.'
                    : 'La coda si ripete dopo l’ultima traccia.'}{' '}
                Puoi riordinare o rimuovere le tracce a seguire.
              </p>
              <div className="autoplay-setting">
                <div>
                  <strong>Riproduzione automatica</strong>
                  <small>
                    Continua con brani simili quando finisce la coda.
                  </small>
                </div>
                <button
                  role="switch"
                  aria-label="Riproduzione automatica"
                  aria-checked={state.autoplay}
                  onClick={() => player.toggleAutoplay()}
                >
                  <span />
                </button>
              </div>
              <button
                className="text-button shuffle-button"
                disabled={state.queue.length - state.index - 1 < 2}
                onClick={() => {
                  player.shuffleUpcoming();
                  setNotice('Ordine dei prossimi brani mescolato');
                }}
              >
                <Icon name="shuffle" size={18} /> Mescola a seguire
              </button>
              <ol className="queue-list">
                {state.queue.map((track, index) => (
                  <li
                    key={`${track.id}-${index}`}
                    className={index === state.index ? 'current-track' : ''}
                  >
                    <button
                      className="track-select"
                      aria-label={`Riproduci posizione ${index + 1}: ${track.title}`}
                      onClick={() => player.select(index)}
                    >
                      <span className="track-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <img
                        src={track.artworkUrl}
                        alt=""
                        width="48"
                        height="48"
                      />
                      <span className="track-copy">
                        <strong>{track.title}</strong>
                        <small>
                          {index === state.index
                            ? 'Selezionata'
                            : index < state.index
                              ? 'Già ascoltata'
                              : 'A seguire'}{' '}
                          · {track.artist}
                        </small>
                      </span>
                    </button>
                    {index > state.index && (
                      <div className="queue-actions">
                        <button
                          className="icon-button"
                          aria-label={`Sposta su posizione ${index + 1}`}
                          disabled={index === state.index + 1}
                          onClick={() => player.moveUpcoming(index, -1)}
                        >
                          <Icon name="up" size={18} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Sposta giù posizione ${index + 1}`}
                          disabled={index === state.queue.length - 1}
                          onClick={() => player.moveUpcoming(index, 1)}
                        >
                          <Icon name="down" size={18} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Rimuovi posizione ${index + 1}`}
                          onClick={() => player.removeUpcoming(index)}
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {state.autoplay && (
                <div className="autoplay-suggestions">
                  <h3>A seguire per te</h3>
                  <p className="muted">
                    {state.autoplayStatus === 'loading'
                      ? 'Cerchiamo brani simili…'
                      : state.autoplayStatus === 'error'
                        ? 'Suggerimenti non disponibili. La tua coda resta pronta.'
                        : !state.autoplayTracks.length
                          ? 'I suggerimenti compaiono quando scegli un brano dal catalogo.'
                          : 'Questi brani iniziano dopo la tua selezione.'}
                  </p>
                  {state.autoplayTracks.slice(0, 5).map((track) => (
                    <button
                      key={track.id}
                      className="suggested-track"
                      onClick={() => playTrack(track)}
                    >
                      <img
                        src={track.artworkUrl}
                        alt=""
                        width="40"
                        height="40"
                      />
                      <span>
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                      <Icon name="play" size={18} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          <div hidden={screen !== 'library'}>
            <CollectionLibrary
              tab={libraryTab}
              onTabChange={setLibraryTab}
              library={library}
              onPlay={playTrack}
              onEnqueue={enqueueTrack}
              onPlayAll={(savedTracks, index) =>
                player.playCollection(savedTracks, index)
              }
              onSearch={() => searchFor()}
              onOpen={openItem}
              playlistId={playlistId}
              onSelectPlaylist={setPlaylistId}
              onAdd={setPlaylistTracks}
            />
          </div>
          <div hidden={screen !== 'search'}>
            <Search
              active={screen === 'search'}
              onDetailChange={setCatalogDetailOpen}
              onPlayTrack={(track) => {
                playTrack(track);
                setNotice(`Avvio: "${track.title}"`);
              }}
              onEnqueueTrack={enqueueTrack}
              onPlayAlbum={playAlbum}
              favoriteIds={favorites.map((track) => track.id)}
              onToggleFavorite={toggleFavorite}
              openRequest={openRequest}
              queryRequest={queryRequest}
              savedIds={[
                ...library.savedAlbums,
                ...library.followedArtists,
              ].map((item) => item.id)}
              onToggleSaved={library.toggleSavedItem}
              onAddPlaylist={setPlaylistTracks}
              onEnqueueAlbum={(albumTracks) => {
                player.enqueueMany(albumTracks);
                setNotice(`${albumTracks.length} brani aggiunti alla coda`);
              }}
            />
          </div>
          {screen === 'diagnostics' && (
            <Diagnostics state={state} player={player} />
          )}
          {state.error && (
            <div className="banner error" role="alert">
              {state.error}{' '}
              <button onClick={() => player.play()}>Riprova audio</button>
            </div>
          )}
          {screen !== 'player' && current && (
            <div className="mini-player">
              <CoverArt src={current.artworkUrl} title={current.title} />
              <button
                className="mini-title"
                aria-label={`Apri player: ${current.title}`}
                onClick={() => setScreen('player')}
              >
                <strong>{current.title}</strong>
                <small>{current.artist}</small>
              </button>
              <button
                className="icon-button"
                aria-label={active ? 'Pausa' : 'Play'}
                onClick={toggle}
              >
                <Icon name={active ? 'pause' : 'play'} />
              </button>
              <button
                className="icon-button"
                aria-label="Traccia successiva"
                disabled={
                  state.index >= state.queue.length - 1 &&
                  state.repeat !== 'all' &&
                  !state.autoplayTracks.length
                }
                onClick={() => player.next()}
              >
                <Icon name="next" />
              </button>
              <button
                className="icon-button mini-queue"
                aria-label="Apri coda"
                onClick={() => setScreen('queue')}
              >
                <Icon name="queue" />
              </button>
              <span className="mini-progress" aria-hidden="true">
                <span
                  style={{
                    width: `${state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0}%`,
                  }}
                />
              </span>
            </div>
          )}
          <footer
            className="content-footer"
            hidden={
              screen !== 'diagnostics' &&
              !demoMode &&
              !(
                screen === 'player' &&
                current?.sourceUrl.includes('soundhelix.com')
              )
            }
          >
            {screen === 'player' || screen === 'diagnostics' ? (
              <p>
                Musica di{' '}
                <a
                  href="https://www.soundhelix.com/audio-examples"
                  target="_blank"
                  rel="noreferrer"
                >
                  T. Schürger / SoundHelix
                </a>{' '}
                · uso autorizzato con attribuzione.
                <br />
                <span>Copertine demo originali MusicBit.</span>
              </p>
            ) : (
              <p>
                MusicBit · Il tuo spazio musicale.
                <br />
                <span>La libreria è salvata su questo dispositivo.</span>
              </p>
            )}
            <div hidden={screen !== 'diagnostics'}>
              <PwaNotice />
            </div>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigazione mobile">
        {screens
          .filter((item) => item.id !== 'diagnostics')
          .map((item) => (
            <button
              key={item.id}
              className={primaryScreen === item.id ? 'selected' : ''}
              aria-current={primaryScreen === item.id ? 'page' : undefined}
              onClick={() => setScreen(item.id)}
            >
              <Icon name={item.icon} size={21} />
              <span>{item.label}</span>
            </button>
          ))}
      </nav>
      {playlistTracks && (
        <PlaylistPicker
          tracks={playlistTracks}
          library={library}
          onClose={() => setPlaylistTracks(undefined)}
          onSaved={(name) => {
            setPlaylistTracks(undefined);
            setNotice(`Aggiunto a “${name}”`);
          }}
        />
      )}
      <div className={`toast ${notice ? 'visible' : ''}`} role="status">
        {notice}
      </div>
    </div>
  );
}
