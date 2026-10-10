import { useEffect, useState, useSyncExternalStore } from 'react';
import { type Track } from '@musicbit/shared';
import { loadCatalog } from './catalog';
import { PlayerEngine } from './player/engine';
import { Icon, type IconName } from './components/Icon';
import { Diagnostics } from './components/Diagnostics';
import { PwaNotice } from './components/PwaNotice';
import { PreparationControls } from './components/PreparationControls';
import { Search } from './components/Search';

type Screen = 'player' | 'search' | 'queue' | 'diagnostics';
const screens: { id: Screen; label: string; icon: IconName }[] = [
  { id: 'player', label: 'Player', icon: 'music' },
  { id: 'search', label: 'Cerca', icon: 'search' },
  { id: 'queue', label: 'Coda', icon: 'queue' },
  { id: 'diagnostics', label: 'Diagnostica', icon: 'pulse' },
];
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

export function App({ player }: { player: PlayerEngine }) {
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [screen, setScreen] = useState<Screen>(() => {
    const value = new URLSearchParams(location.search).get('screen');
    return value === 'diagnostics' || value === 'search' ? value : 'player';
  });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const current = state.queue[state.index];
  const active = state.status === 'playing' || state.status === 'loading';

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal, (timing) => player.recordCatalog(timing))
      .then((data) => {
        if (controller.signal.aborted) return;
        setTracks(data.tracks);
        player.setCatalog(data.tracks);
        setCatalogStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogStatus('error');
      });
    return () => controller.abort();
  }, [player, reload]);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="MusicBit home"
          onClick={(event) => {
            event.preventDefault();
            setScreen('player');
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
                className={`nav-item ${screen === item.id ? 'selected' : ''}`}
                aria-current={screen === item.id ? 'page' : undefined}
                onClick={() => setScreen(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.id === 'queue' && (
                  <span className="count">{state.queue.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Personale. Self-hosted.<small>MILESTONE 03 · CATALOGO</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>La tua musica, nel tuo spazio.</span>
          <span className="pill">
            <span className={`status-dot ${online ? '' : 'offline'}`} />
            {online ? 'Online' : 'Offline'}
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {screen === 'search'
                  ? 'MUSICBIT / CATALOGO MUSICALE'
                  : 'MUSICBIT / DEMO SESSIONS'}
              </p>
              <h1>
                {screen === 'player'
                  ? 'Premi play. Prenditi spazio.'
                  : screen === 'search'
                    ? 'La musica comincia da un nome.'
                    : screen === 'queue'
                      ? 'Il prossimo ascolto.'
                      : 'Ogni millisecondo conta.'}
              </h1>
              <p className="muted">
                {screen === 'player'
                  ? 'Tre tracce per iniziare. Niente distrazioni, solo musica.'
                  : screen === 'search'
                    ? 'Cerca, scopri i dettagli, esplora il catalogo.'
                    : screen === 'queue'
                      ? 'La tua sessione, nell’ordine che scegli tu.'
                      : 'Osserva cosa succede tra il tocco e la musica.'}
              </p>
            </div>
            <span className="version-tag">M3</span>
          </div>
          {!online && (
            <p className="banner" role="status">
              Sei offline. L’interfaccia resta disponibile; catalogo e nuove
              tracce richiedono rete.
            </p>
          )}
          {catalogStatus === 'loading' && (
            <p className="banner" role="status">
              Caricamento della libreria…
            </p>
          )}
          {catalogStatus === 'error' && (
            <div className="banner error" role="alert">
              Impossibile caricare la libreria. Verifica che l’API sia avviata.{' '}
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
          {screen === 'player' && (
            <div className="player-grid">
              <section className="now-playing" aria-label="In riproduzione">
                <div className="section-heading">
                  <p className="eyebrow">IN ASCOLTO</p>
                  <span className="small-label">
                    {current
                      ? `${String(state.index + 1).padStart(2, '0')} / ${String(state.queue.length).padStart(2, '0')}`
                      : '—'}
                  </span>
                </div>
                <div
                  className={`artwork-wrap ${state.status === 'playing' ? 'is-playing' : ''}`}
                >
                  <img
                    className="hero-artwork"
                    src={current?.artworkUrl ?? '/artwork/session-1.png'}
                    alt="Copertina astratta della sessione"
                  />
                  <span className="artwork-caption">
                    SOUNDHELIX
                    <br />
                    <b>
                      SESSIONS /{' '}
                      {current?.id.split('-').at(-1)?.padStart(2, '0') ?? '01'}
                    </b>
                  </span>
                </div>
                <div className="track-heading">
                  <div>
                    <h2>{current?.title ?? 'Scegli la tua prima traccia'}</h2>
                    <p>
                      {current?.artist ??
                        'La libreria sarà pronta tra un momento'}
                      <span> · </span>SoundHelix
                    </p>
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
                      !current || (state.index === 0 && state.position <= 3)
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
                    disabled={!current || state.index >= state.queue.length - 1}
                    onClick={() => player.next()}
                  >
                    <Icon name="next" size={26} />
                  </button>
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
                <PreparationControls player={player} state={state} />
              </section>
              <div className="library-column">
                <section className="library" aria-labelledby="library-title">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">LA TUA LIBRERIA</p>
                      <h2 id="library-title">Demo sessions</h2>
                    </div>
                    <span className="small-label">{tracks.length} tracce</span>
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
                <section className="next-card">
                  <div>
                    <p className="eyebrow">A SEGUIRE</p>
                    <h3>
                      {state.queue[state.index + 1]?.title ??
                        'Hai raggiunto la fine'}
                    </h3>
                    <p className="muted">
                      {state.queue[state.index + 1]?.artist ??
                        'Aggiungi una traccia dalla libreria.'}
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
                <section className="listening-note">
                  <span className="note-orbit" aria-hidden="true">
                    ◎
                  </span>
                  <p>
                    Uno spazio tutto tuo.
                    <br />
                    <strong>Una traccia alla volta.</strong>
                  </p>
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
                La coda termina dopo l’ultima traccia. Puoi riordinare o
                rimuovere le tracce a seguire.
              </p>
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
            </section>
          )}
          {screen === 'search' && <Search />}
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
              <img src={current.artworkUrl} alt="" width="44" height="44" />
              <button
                className="mini-title"
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
                disabled={state.index >= state.queue.length - 1}
                onClick={() => player.next()}
              >
                <Icon name="next" />
              </button>
            </div>
          )}
          <footer className="content-footer">
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
              <span>
                Copertine demo originali MusicBit. Player M2 verificato su
                iPhone dall’utente. CarPlay e regressione M3 su dispositivo da
                verificare.
              </span>
            </p>
            <PwaNotice />
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigazione mobile">
        {screens.map((item) => (
          <button
            key={item.id}
            className={screen === item.id ? 'selected' : ''}
            aria-current={screen === item.id ? 'page' : undefined}
            onClick={() => setScreen(item.id)}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className={`toast ${notice ? 'visible' : ''}`} role="status">
        {notice}
      </div>
    </div>
  );
}
