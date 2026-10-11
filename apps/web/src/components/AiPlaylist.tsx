import { useEffect, useRef, useState } from 'react';
import {
  isTracksResponse,
  type GeneratedPlaylist,
  type Track,
} from '@musicbit/shared';
import { accountRequest } from '../account';
import type { LibraryModel } from '../library';
import { CoverArt } from './CoverArt';
import { Icon } from './Icon';
export function AiPlaylist({
  accountId,
  library,
  onSignIn,
  onPlayAll,
  onSaved,
}: {
  accountId?: string;
  library: LibraryModel;
  onSignIn: () => void;
  onPlayAll: (tracks: Track[]) => void;
  onSaved: (id: string) => void;
}) {
  const [available, setAvailable] = useState<boolean>(),
    [localModel, setLocalModel] = useState(false),
    [prompt, setPrompt] = useState(''),
    [count, setCount] = useState(12),
    [useTaste, setUseTaste] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<GeneratedPlaylist>(),
    [error, setError] = useState(''),
    [excluded, setExcluded] = useState<string[]>([]);
  const generation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void accountRequest<{ available: boolean; provider?: string }>(
      '/api/me/ai-playlists/status',
      undefined,
      'GET',
      controller.signal,
    )
      .then((s) => {
        if (!controller.signal.aborted) {
          setAvailable(s.available);
          setLocalModel(s.provider === 'Ollama');
          if (s.provider === 'Ollama') setCount(5);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Impossibile verificare il servizio AI.');
      });
    return () => {
      controller.abort();
      generation.current?.abort();
    };
  }, [accountId]);
  const tracks = result?.tracks.filter((t) => !excluded.includes(t.id)) ?? [];
  return (
    <div className="ai-playlist-page">
      <section className="ai-playlist-hero">
        <span className="eyebrow">UN’IDEA DIVENTA MUSICA</span>
        <h2>
          Descrivi il momento.
          <br />
          <em>Trova il tuo mix.</em>
        </h2>
        <p>
          Una playlist creata con AI, con brani cercati nel catalogo e
          un’anteprima da modificare.
        </p>
      </section>
      {!accountId ? (
        <section className="profile-card">
          <h3>Accedi per creare una playlist AI</h3>
          <button className="primary-play-btn" onClick={onSignIn}>
            Accedi al tuo profilo
          </button>
        </section>
      ) : (
        <form
          className="profile-card ai-playlist-form"
          onSubmit={(e) => {
            e.preventDefault();
            const controller = new AbortController();
            generation.current = controller;
            setBusy(true);
            setError('');
            setResult(undefined);
            setExcluded([]);
            void accountRequest<GeneratedPlaylist>(
              '/api/me/ai-playlists',
              { prompt, count, useTaste },
              'POST',
              controller.signal,
              190000,
            )
              .then((data) => {
                if (
                  !isTracksResponse({ provider: 'ai', tracks: data.tracks }) ||
                  typeof data.name !== 'string' ||
                  typeof data.description !== 'string' ||
                  !Array.isArray(data.unmatched)
                )
                  throw new Error('La playlist ricevuta non è valida.');
                if (!controller.signal.aborted) setResult(data);
              })
              .catch((e: unknown) => {
                if (!controller.signal.aborted)
                  setError(
                    e instanceof Error ? e.message : 'Creazione non riuscita.',
                  );
              })
              .finally(() => {
                if (!controller.signal.aborted) setBusy(false);
              });
          }}
        >
          <label>
            Che playlist immagini?
            <textarea
              required
              minLength={3}
              maxLength={600}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Un viaggio notturno: elettronica morbida, un po’ di synth-pop, senza brani troppo energici…"
              disabled={busy}
            />
          </label>
          <div className="profile-actions">
            <label>
              Numero di brani
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                disabled={busy}
              >
                {[5, 8, 12, 16, 20].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="taste-opt-in">
              <input
                type="checkbox"
                checked={useTaste}
                onChange={(e) => setUseTaste(e.target.checked)}
                disabled={busy}
              />
              Usa anche il mio Taste Profile
            </label>
          </div>
          {localModel && (
            <p className="muted">
              Il modello locale può richiedere fino a tre minuti. Inizia con 5
              brani; playlist più lunghe possono superare il tempo disponibile.
            </p>
          )}
          <p className="muted">
            La descrizione viene elaborata dal modello AI configurato sul
            server. Se attivi Taste Profile, inviamo anche fino a 10 artisti
            affini. Password, cronologia completa e file audio restano esclusi.
          </p>
          {available === false && (
            <p className="banner">
              Il servizio AI deve essere configurato dall’amministratore di
              questa istanza.
            </p>
          )}
          <div className="profile-actions">
            <button
              className="primary-play-btn"
              disabled={busy || available !== true}
            >
              {busy
                ? 'Creazione e verifica dei brani…'
                : 'Crea playlist con AI'}
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => {
                  generation.current?.abort();
                  setBusy(false);
                }}
              >
                Annulla creazione
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <section className="profile-card ai-preview">
          <p className="eyebrow">
            ANTEPRIMA · {tracks.length} BRANI SELEZIONATI
          </p>
          <h2>{result.name}</h2>
          <p>{result.description}</p>
          <div className="profile-actions">
            <button
              className="primary-play-btn"
              disabled={!tracks.length}
              onClick={() => onPlayAll(tracks)}
            >
              <Icon name="play" size={18} />
              Ascolta anteprima
            </button>
            <button
              disabled={!tracks.length || library.playlists.length >= 100}
              onClick={() => {
                const id = library.createPlaylist(result.name, tracks);
                if (id) onSaved(id);
                else
                  setError(
                    'Impossibile salvare: la libreria ha raggiunto il limite.',
                  );
              }}
            >
              Salva playlist nella libreria
            </button>
          </div>
          <ol className="wrapped-ranking">
            {result.tracks.map((track) => (
              <li key={track.id}>
                <label className="ai-track-choice">
                  <input
                    type="checkbox"
                    checked={!excluded.includes(track.id)}
                    onChange={() =>
                      setExcluded((values) =>
                        values.includes(track.id)
                          ? values.filter((id) => id !== track.id)
                          : [...values, track.id],
                      )
                    }
                  />
                  <CoverArt src={track.artworkUrl} title={track.title} />
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                </label>
              </li>
            ))}
          </ol>
          {!!result.unmatched.length && (
            <details>
              <summary>
                {result.unmatched.length} proposte non disponibili o senza
                corrispondenza certa
              </summary>
              <ul>
                {result.unmatched.map((song, i) => (
                  <li key={i}>
                    {song.title} — {song.artist}
                  </li>
                ))}
              </ul>
              <p className="muted">Questi brani non verranno salvati.</p>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
