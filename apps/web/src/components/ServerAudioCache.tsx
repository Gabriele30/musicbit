import { useEffect, useState } from 'react';
import type { AudioCacheStatus } from '@musicbit/shared';
import { accountRequest } from '../account';

export function ServerAudioCache() {
  const [status, setStatus] = useState<AudioCacheStatus>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void accountRequest<AudioCacheStatus>(
      '/api/me/audio-cache',
      undefined,
      'GET',
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setStatus(data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [refresh]);
  if (status && !status.enabled) return null;
  return (
    <section className="profile-card" aria-label="Cache audio sul server">
      <div className="section-heading">
        <h2>La tua musica, pronta prima</h2>
        <button
          className="text-button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Aggiorna spazio
        </button>
      </div>
      {status?.enabled ? (
        <>
          <p>
            {status.tracks} brani pronti ·{' '}
            {(status.bytes / 1_000_000).toLocaleString('it-IT', {
              maximumFractionDigits: 1,
            })}{' '}
            MB di {status.quotaBytes / 1_000_000_000} GB
          </p>
          <progress
            className="server-cache-progress"
            aria-label="Spazio cache utilizzato"
            value={status.bytes}
            max={status.quotaBytes}
          />
          {status.preparing > 0 && (
            <p className="muted">Preparazione dei prossimi brani in corso…</p>
          )}
        </>
      ) : (
        <p className="muted">
          {error
            ? 'Spazio temporaneamente non disponibile. Riprova.'
            : 'Controllo dello spazio…'}
        </p>
      )}
      <p className="muted">
        Il server prepara i prossimi 10 brani. Lo spazio è personale e si libera
        automaticamente; sul telefono serve ancora una connessione.
      </p>
    </section>
  );
}
