import { useState } from 'react';
import { buildTasteProfile } from '@musicbit/shared';
import type { LibraryModel } from '../library';
export function TasteProfile({ library }: { library: LibraryModel }) {
  const [expanded, setExpanded] = useState(false),
    [reset, setReset] = useState(false);
  const artists = buildTasteProfile(library.snapshot);
  const knownTracks = [
    ...library.favorites,
    ...library.history.map((h) => h.track),
  ];
  return (
    <section
      className="profile-card taste-profile"
      aria-labelledby="taste-title"
    >
      <p className="eyebrow">TU DECIDI COSA TI RAPPRESENTA</p>
      <h2 id="taste-title" tabIndex={-1}>
        Taste Profile
      </h2>
      <p className="muted">
        Questi artisti emergono da preferiti, artisti seguiti, ascolti
        completati e brani saltati. Correggi i suggerimenti quando qualcosa non
        ti rappresenta.
      </p>
      <label>
        Varietà dei suggerimenti
        <select
          value={library.taste?.novelty ?? 'balanced'}
          onChange={(e) =>
            library.setNovelty(
              e.target.value as 'balanced' | 'familiar' | 'discovery',
            )
          }
        >
          <option value="familiar">Più musica familiare</option>
          <option value="balanced">Un equilibrio tra preferiti e novità</option>
          <option value="discovery">Più scoperte</option>
        </select>
      </label>
      {!artists.length && (
        <p className="muted">
          Salva qualche preferito o ascolta musica: il tuo profilo nascerà da
          lì.
        </p>
      )}
      <ul className="taste-artists">
        {artists.slice(0, expanded ? 200 : 8).map((artist) => (
          <li key={artist.key}>
            <div>
              <strong>{artist.artist}</strong>
              <small>
                {artist.favorites} preferiti · {artist.recent} ascolti recenti
                {artist.followed ? ' · Seguito' : ''}
              </small>
              <small>
                Affinità rilevata:{' '}
                {artist.inferredScore > 8
                  ? 'alta'
                  : artist.inferredScore > 2
                    ? 'media'
                    : 'in formazione'}
              </small>
            </div>
            <select
              aria-label={`Preferenza per ${artist.artist}`}
              value={artist.preference}
              onChange={(e) =>
                library.setArtistPreference(
                  artist.artist,
                  e.target.value as 'auto' | 'more' | 'less' | 'blocked',
                )
              }
            >
              <option value="auto">Automatica</option>
              <option value="more">Più di questo</option>
              <option value="less">Meno di questo</option>
              <option value="blocked">Escludi dai consigli</option>
            </select>
          </li>
        ))}
      </ul>
      {artists.length > 8 && (
        <button className="text-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Mostra meno artisti' : 'Mostra tutti gli artisti'}
        </button>
      )}
      {!!library.history.length && (
        <details>
          <summary>Ascolti che influenzano il profilo</summary>
          <p className="muted">
            Puoi escludere ascolti occasionali dal profilo senza cancellarli
            dalla cronologia o dalle statistiche.
          </p>
          <ul className="taste-history">
            {library.history.slice(0, 30).map(({ track }) => (
              <li key={track.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      !library.taste?.excludedFromTaste?.includes(track.id)
                    }
                    onChange={() => library.toggleTasteExclusion(track.id)}
                  />
                  <span>
                    {track.title}
                    <small>{track.artist}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!library.taste?.dismissed.length && (
        <details>
          <summary>
            Brani esclusi dai consigli ({library.taste.dismissed.length})
          </summary>
          <ul className="taste-history">
            {library.taste.dismissed.map((id) => (
              <li key={id}>
                <span>
                  {knownTracks.find((t) => t.id === id)?.title ??
                    'Brano escluso'}
                </span>
                <button
                  className="text-button"
                  aria-label={`Riammetti ${knownTracks.find((t) => t.id === id)?.title ?? id}`}
                  onClick={() => library.restoreDismissed(id)}
                >
                  Riammetti
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {reset ? (
        <div className="profile-conflict">
          <p>
            Rimuovere le correzioni e i segnali di completamento e salto?
            Preferiti, artisti seguiti e cronologia continueranno a formare il
            profilo.
          </p>
          <div className="profile-actions">
            <button
              onClick={() => {
                library.resetTaste();
                setReset(false);
              }}
            >
              Conferma ripristino preferenze
            </button>
            <button onClick={() => setReset(false)}>Annulla</button>
          </div>
        </div>
      ) : (
        <button className="text-button" onClick={() => setReset(true)}>
          Reimposta preferenze dei suggerimenti
        </button>
      )}
    </section>
  );
}
