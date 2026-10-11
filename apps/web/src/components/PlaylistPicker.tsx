import { useEffect, useRef, useState } from 'react';
import type { Track } from '@musicbit/shared';
import type { LibraryModel } from '../library';
import { CoverArt } from './CoverArt';

export function PlaylistPicker({
  tracks,
  library,
  onClose,
  onSaved,
}: {
  tracks: Track[];
  library: LibraryModel;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(!library.playlists.length);
  const [error, setError] = useState('');
  const choices = library.playlists.filter((list) =>
    list.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    if (node?.showModal) node.showModal();
    else node?.setAttribute('open', '');
    return () => {
      node?.close?.();
      if (
        opener instanceof HTMLElement &&
        opener.getClientRects().length &&
        !document.querySelector('dialog[open]')
      )
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="playlist-dialog"
      aria-labelledby="playlist-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="playlist-picker-title">Aggiungi a playlist</h2>
        <button
          className="text-button"
          onClick={onClose}
          aria-label="Chiudi playlist"
        >
          Chiudi
        </button>
      </div>
      <p className="muted">
        {tracks.length === 1
          ? tracks[0]?.title
          : `${tracks.length} brani selezionati`}
      </p>
      {library.playlists.length >= 5 && (
        <input
          type="search"
          aria-label="Filtra playlist"
          placeholder="Trova una playlist"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <div className="playlist-choices">
        {choices.map((list) => (
          <button
            key={list.id}
            onClick={() => {
              if (library.addToPlaylist(list.id, tracks)) onSaved(list.name);
              else
                setError(
                  'Una playlist può contenere fino a 1000 brani. Scegline un’altra.',
                );
            }}
          >
            <CoverArt src={list.tracks[0]?.artworkUrl} title={list.name} />
            <span>
              <strong>{list.name}</strong>
              <small>{list.tracks.length} brani</small>
            </span>
          </button>
        ))}
      </div>
      {filter && !choices.length && (
        <p className="muted">Nessuna playlist con questo nome.</p>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {!creating && (
        <button className="secondary-btn" onClick={() => setCreating(true)}>
          Crea nuova playlist
        </button>
      )}
      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (library.createPlaylist(name, tracks)) onSaved(name.trim());
          }}
        >
          <label htmlFor="new-playlist-name">Nuova playlist</label>
          <input
            id="new-playlist-name"
            placeholder="Dai un nome alla tua playlist"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <button
            className="primary-play-btn"
            disabled={!name.trim() || library.playlists.length >= 100}
          >
            Crea e aggiungi
          </button>
        </form>
      )}
    </dialog>
  );
}
