import { useState } from 'react';
import type { Track } from '@musicbit/shared';
import { Icon } from './Icon';
import { CoverArt } from './CoverArt';

export function Library({
  tracks,
  onPlay,
  onEnqueue,
  onRemove,
  onPlayAll,
  onSearch,
}: {
  tracks: Track[];
  onPlay: (track: Track) => void;
  onEnqueue: (track: Track) => void;
  onRemove: (track: Track) => void;
  onPlayAll: (tracks: Track[]) => void;
  onSearch: () => void;
}) {
  const [query, setQuery] = useState('');
  const visible = tracks.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`
      .toLocaleLowerCase('it')
      .includes(query.trim().toLocaleLowerCase('it')),
  );
  return (
    <section className="queue-section" aria-labelledby="favorites-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LA TUA LIBRERIA</p>
          <h2 id="favorites-title">Brani preferiti</h2>
        </div>
        <span className="small-label">
          {tracks.length} {tracks.length === 1 ? 'brano' : 'brani'}
        </span>
      </div>
      <p className="muted">
        La musica che vuoi ritrovare. Per ascoltarla serve una connessione.
      </p>
      {tracks.length ? (
        <>
          <div className="library-tools">
            <button
              className="primary-play-btn"
              disabled={!visible.length}
              onClick={() => onPlayAll(visible)}
            >
              <Icon name="play" size={18} /> Riproduci preferiti
            </button>
            <input
              type="search"
              aria-label="Filtra i preferiti"
              placeholder="Filtra titolo o artista…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {!visible.length && (
            <p role="status" className="muted">
              Nessun preferito corrisponde alla ricerca.
            </p>
          )}
          <ol className="queue-list favorite-list">
            {visible.map((track) => (
              <li key={track.id}>
                <button
                  className="track-select"
                  aria-label={`Riproduci preferito ${track.title}`}
                  onClick={() => onPlay(track)}
                >
                  <CoverArt src={track.artworkUrl} title={track.title} />
                  <span className="track-copy">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                </button>
                <div className="queue-actions">
                  <button
                    className="icon-button"
                    aria-label={`Accoda preferito ${track.title}`}
                    onClick={() => onEnqueue(track)}
                  >
                    <Icon name="plus" size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Rimuovi ${track.title} dai preferiti`}
                    onClick={() => onRemove(track)}
                  >
                    <Icon name="heart" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="library-empty">
          <Icon name="heart" size={32} />
          <h3>La tua musica comincia qui.</h3>
          <p className="muted">
            Tocca il cuore nel player o nei dettagli di un brano per ritrovarlo
            qui.
          </p>
          <button className="primary-play-btn" onClick={onSearch}>
            <Icon name="search" size={18} /> Trova musica
          </button>
        </div>
      )}
    </section>
  );
}
