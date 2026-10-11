import { useState } from 'react';
import type { CatalogItem, Track } from '@musicbit/shared';
import type { LibraryModel } from '../library';
import { Library } from './Library';
import { CatalogShelf } from './Home';
import { Icon } from './Icon';
import { ActionMenu } from './ActionMenu';
import { CoverArt } from './CoverArt';

export type LibraryTab =
  | 'favorites'
  | 'playlists'
  | 'albums'
  | 'artists'
  | 'history';
export function CollectionLibrary({
  library,
  onPlay,
  onPlayAll,
  onEnqueue,
  onSearch,
  onOpen,
  playlistId,
  onSelectPlaylist,
  onAdd,
  tab,
  onTabChange: setTab,
}: {
  library: LibraryModel;
  onPlay: (track: Track) => void;
  onPlayAll: (tracks: Track[], index?: number) => void;
  onEnqueue: (track: Track) => void;
  onSearch: () => void;
  onOpen: (item: CatalogItem) => void;
  playlistId?: string;
  onSelectPlaylist: (id?: string) => void;
  onAdd: (tracks: Track[]) => void;
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [removed, setRemoved] = useState<{
    playlistId: string;
    track: Track;
    index: number;
  }>();
  const selected = library.playlists.find((list) => list.id === playlistId);
  const activeTab = selected ? 'playlists' : tab;
  return (
    <div className="collection-library">
      <div
        className="catalog-filters library-tabs"
        role="group"
        aria-label="Sezioni della libreria"
      >
        {(
          ['favorites', 'playlists', 'albums', 'artists', 'history'] as const
        ).map((key) => (
          <button
            key={key}
            aria-pressed={activeTab === key}
            onClick={() => {
              setTab(key);
              onSelectPlaylist();
              setDeleting(false);
            }}
          >
            {
              {
                favorites: 'Preferiti',
                playlists: 'Playlist',
                albums: 'Album',
                artists: 'Artisti',
                history: 'Cronologia',
              }[key]
            }
          </button>
        ))}
      </div>
      {activeTab === 'favorites' && (
        <>
          <Library
            tracks={library.favorites}
            onPlay={onPlay}
            onEnqueue={onEnqueue}
            onRemove={library.toggleFavorite}
            onPlayAll={onPlayAll}
            onSearch={onSearch}
          />
          {!!library.favorites.length && (
            <button
              className="secondary-btn"
              onClick={() => onAdd(library.favorites)}
            >
              Aggiungi preferiti a una playlist
            </button>
          )}
        </>
      )}
      {activeTab === 'playlists' &&
        (selected ? (
          <section className="queue-section">
            <button
              className="text-button"
              onClick={() => {
                onSelectPlaylist();
                setTab('playlists');
                setDeleting(false);
              }}
            >
              ← Tutte le playlist
            </button>
            <div className="playlist-heading">
              <CoverArt
                className="playlist-large-cover"
                src={selected.tracks[0]?.artworkUrl}
                title={selected.name}
              />
              <div>
                <p className="eyebrow">LA TUA PLAYLIST</p>
                <h2>{selected.name}</h2>
                <p className="muted">
                  {selected.tracks.length} brani · Salvata su questo dispositivo
                </p>
              </div>
            </div>
            <div className="library-tools playlist-toolbar">
              <button
                className="primary-play-btn"
                aria-label="Riproduci playlist"
                disabled={!selected.tracks.length}
                onClick={() => onPlayAll(selected.tracks)}
              >
                <Icon name="play" size={18} /> Riproduci
              </button>
              <button
                className="icon-button playlist-shuffle"
                aria-label="Riproduci playlist in ordine casuale"
                disabled={!selected.tracks.length}
                onClick={() => {
                  const tracks = [...selected.tracks];
                  for (let i = tracks.length - 1; i > 0; i--) {
                    const other = Math.floor(Math.random() * (i + 1));
                    [tracks[i], tracks[other]] = [tracks[other]!, tracks[i]!];
                  }
                  onPlayAll(tracks);
                }}
              >
                <Icon name="shuffle" size={20} />
              </button>
              <button className="text-button" onClick={onSearch}>
                Aggiungi musica
              </button>
              <ActionMenu
                label="Opzioni playlist"
                title={selected.name}
                actions={[
                  {
                    label: 'Rinomina playlist',
                    icon: 'music',
                    onSelect: () => {
                      setName(selected.name);
                      setRenamingId(selected.id);
                    },
                  },
                  {
                    label:
                      editingId === selected.id
                        ? 'Termina modifica'
                        : 'Modifica brani',
                    icon: 'queue',
                    onSelect: () =>
                      setEditingId(
                        editingId === selected.id ? undefined : selected.id,
                      ),
                  },
                  {
                    label: 'Elimina playlist',
                    icon: 'close',
                    onSelect: () => setDeleting(true),
                  },
                ]}
              />
            </div>
            {renamingId === selected.id && (
              <form
                className="playlist-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  library.renamePlaylist(selected.id, name);
                  setName('');
                  setRenamingId(undefined);
                }}
              >
                <input
                  aria-label="Nuovo nome playlist"
                  placeholder="Rinomina playlist…"
                  maxLength={80}
                  value={name}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
                <button className="secondary-btn" disabled={!name.trim()}>
                  Rinomina
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setRenamingId(undefined)}
                >
                  Annulla rinomina
                </button>
              </form>
            )}
            {editingId === selected.id && (
              <div className="playlist-edit-notice">
                <p className="muted">
                  Trascina i brani o usa le frecce per cambiarne l’ordine.
                </p>
                <button
                  className="secondary-btn"
                  onClick={() => setEditingId(undefined)}
                >
                  Fine modifica
                </button>
              </div>
            )}
            {removed?.playlistId === selected.id && (
              <div className="banner playlist-undo" role="status">
                <span>“{removed.track.title}” rimosso.</span>
                <button
                  onClick={() => {
                    library.restorePlaylistTrack(
                      selected.id,
                      removed.track,
                      removed.index,
                    );
                    setRemoved(undefined);
                  }}
                >
                  Annulla rimozione
                </button>
                <button
                  className="icon-button"
                  aria-label="Chiudi avviso rimozione"
                  onClick={() => setRemoved(undefined)}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}
            {!selected.tracks.length && (
              <p className="muted">
                Cerca un brano e scegli “Aggiungi a playlist” nei dettagli.
              </p>
            )}
            <ol className="queue-list">
              {selected.tracks.map((track, index) => (
                <li
                  key={track.id}
                  draggable={editingId === selected.id}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      'text/plain',
                      `${selected.id}:${track.id}`,
                    );
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    if (editingId === selected.id) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (editingId !== selected.id) return;
                    const value = event.dataTransfer.getData('text/plain');
                    const from = selected.tracks.findIndex(
                      (item) => `${selected.id}:${item.id}` === value,
                    );
                    if (from >= 0)
                      library.reorderPlaylistTrack(selected.id, from, index);
                  }}
                >
                  <button
                    className="track-select"
                    aria-label={`Riproduci ${track.title}`}
                    onClick={() => onPlayAll(selected.tracks, index)}
                  >
                    <CoverArt src={track.artworkUrl} title={track.title} />
                    <span className="track-copy">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                  </button>
                  <div className="queue-actions">
                    {editingId === selected.id ? (
                      <>
                        <button
                          className="icon-button"
                          aria-label={`Sposta su ${track.title}`}
                          disabled={index === 0}
                          onClick={() =>
                            library.movePlaylistTrack(selected.id, index, -1)
                          }
                        >
                          <Icon name="up" size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Sposta giù ${track.title}`}
                          disabled={index === selected.tracks.length - 1}
                          onClick={() =>
                            library.movePlaylistTrack(selected.id, index, 1)
                          }
                        >
                          <Icon name="down" size={17} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Rimuovi ${track.title} dalla playlist`}
                          onClick={() => {
                            setRemoved({
                              playlistId: selected.id,
                              track,
                              index,
                            });
                            library.removeFromPlaylist(selected.id, track.id);
                          }}
                        >
                          <Icon name="close" size={17} />
                        </button>
                      </>
                    ) : (
                      <ActionMenu
                        label={`Opzioni brano ${track.title}`}
                        title={track.title}
                        actions={[
                          {
                            label: 'Aggiungi alla coda',
                            icon: 'queue',
                            onSelect: () => onEnqueue(track),
                          },
                          {
                            label: 'Aggiungi a playlist',
                            icon: 'plus',
                            onSelect: () => onAdd([track]),
                          },
                          {
                            label: 'Rimuovi dalla playlist',
                            icon: 'close',
                            onSelect: () => {
                              setRemoved({
                                playlistId: selected.id,
                                track,
                                index,
                              });
                              library.removeFromPlaylist(selected.id, track.id);
                            },
                          },
                        ]}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {deleting ? (
              <div className="banner">
                <p>Eliminare “{selected.name}” dalla libreria?</p>
                <button
                  onClick={() => {
                    library.deletePlaylist(selected.id);
                    onSelectPlaylist();
                    setTab('playlists');
                    setDeleting(false);
                  }}
                >
                  Conferma eliminazione
                </button>{' '}
                <button onClick={() => setDeleting(false)}>Annulla</button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="queue-section">
            <h2>Le tue playlist</h2>
            <form
              className="playlist-rename"
              onSubmit={(event) => {
                event.preventDefault();
                const id = library.createPlaylist(name);
                if (id) {
                  onSelectPlaylist(id);
                  setName('');
                }
              }}
            >
              <input
                aria-label="Nome nuova playlist"
                placeholder="Nome della nuova playlist"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                className="primary-play-btn"
                disabled={!name.trim() || library.playlists.length >= 100}
              >
                <Icon name="plus" size={18} /> Crea playlist
              </button>
            </form>
            <div className="playlist-shortcuts">
              {library.playlists.map((list) => (
                <button key={list.id} onClick={() => onSelectPlaylist(list.id)}>
                  <span className="playlist-cover">
                    {list.tracks[0] ? (
                      <img src={list.tracks[0].artworkUrl} alt="" />
                    ) : (
                      <Icon name="music" />
                    )}
                  </span>
                  <strong>{list.name}</strong>
                  <small>{list.tracks.length} brani</small>
                </button>
              ))}
            </div>
            {!library.playlists.length && (
              <p className="muted">
                Raccogli i brani per ogni momento della giornata.
              </p>
            )}
          </section>
        ))}
      {activeTab === 'albums' && (
        <>
          <CatalogShelf
            title="Album salvati"
            items={library.savedAlbums}
            onOpen={onOpen}
            onPlay={onPlay}
          />
          {!library.savedAlbums.length && (
            <p className="muted">Cerca un album e tocca “Salva album”.</p>
          )}
        </>
      )}
      {activeTab === 'artists' && (
        <>
          <CatalogShelf
            title="Artisti seguiti"
            items={library.followedArtists}
            onOpen={onOpen}
            onPlay={onPlay}
          />
          {!library.followedArtists.length && (
            <p className="muted">
              Apri un artista e tocca “Segui artista” per ritrovarlo qui.
            </p>
          )}
        </>
      )}
      {activeTab === 'history' && (
        <section className="queue-section">
          <div className="section-heading">
            <h2>Ascoltati di recente</h2>
            <button
              className="text-button"
              disabled={!library.history.length}
              onClick={library.clearHistory}
            >
              Cancella cronologia
            </button>
          </div>
          <ol className="queue-list">
            {library.history.map(({ track, playedAt }) => (
              <li key={track.id}>
                <button
                  className="track-select"
                  onClick={() => onPlay(track)}
                  aria-label={`Riascolta ${track.title}`}
                >
                  <img
                    src={track.artworkUrl}
                    alt=""
                    width="48"
                    height="48"
                    loading="lazy"
                  />
                  <span className="track-copy">
                    <strong>{track.title}</strong>
                    <small>
                      {track.artist} ·{' '}
                      {new Date(playedAt).toLocaleDateString('it')}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Accoda ${track.title}`}
                  onClick={() => onEnqueue(track)}
                >
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ol>
          {!library.history.length && (
            <p className="muted">I brani ascoltati compariranno qui.</p>
          )}
        </section>
      )}
    </div>
  );
}
