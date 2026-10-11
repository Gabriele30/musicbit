import { useEffect, useState } from 'react';
import type { ListeningStats, Track } from '@musicbit/shared';
import { accountRequest } from '../account';
import { guestListeningStats, LISTENING_CHANGED } from '../player/listening';
import { CoverArt } from './CoverArt';
import { Icon } from './Icon';
export function Wrapped({
  accountId,
  onPlay,
  onSearch,
}: {
  accountId?: string;
  onPlay: (track: Track) => void;
  onSearch: (q: string) => void;
}) {
  const currentYear = new Date().getUTCFullYear(),
    [year, setYear] = useState(currentYear),
    [month, setMonth] = useState(0),
    [stats, setStats] = useState<ListeningStats>(),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [clearing, setClearing] = useState(false);
  useEffect(() => {
    const updated = () => setRefresh((v) => v + 1);
    window.addEventListener(LISTENING_CHANGED, updated);
    return () => window.removeEventListener(LISTENING_CHANGED, updated);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (!accountId) {
      setStats(guestListeningStats(year, month || undefined));
      return;
    }
    void accountRequest<ListeningStats>(
      `/api/me/stats?${new URLSearchParams({ year: String(year), ...(month ? { month: String(month) } : {}) })}`,
      undefined,
      'GET',
      controller.signal,
    )
      .then((s) => {
        if (!controller.signal.aborted) setStats(s);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Impossibile aggiornare le statistiche. Riprova.');
      });
    return () => controller.abort();
  }, [accountId, year, month, refresh]);
  const max = Math.max(1, ...(stats?.months.map((m) => m.seconds) ?? []));
  return (
    <div className="wrapped-page">
      <section className="wrapped-hero">
        <p className="eyebrow">IL TUO ANNO, OGNI GIORNO</p>
        <h2>
          MusicBit
          <br />
          <em>Wrapped.</em>
        </h2>
        <p>La tua musica racconta una storia. Seguila tutto l’anno.</p>
        <div className="wrapped-period">
          <label>
            Anno
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from(
                { length: currentYear - 2019 },
                (_, i) => currentYear - i,
              ).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Periodo
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              <option value={0}>Tutto l’anno</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {new Date(Date.UTC(year, i, 1)).toLocaleDateString('it-IT', {
                    month: 'long',
                    timeZone: 'UTC',
                  })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <p className="muted">
        Tempo realmente riprodotto, aggiornato durante l’ascolto. Un ascolto
        conta dopo 30 secondi o metà del brano, se più breve. I periodi usano il
        fuso UTC.
        {!accountId && ' Le statistiche ospite restano su questo dispositivo.'}
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}{' '}
          <button onClick={() => setRefresh((v) => v + 1)}>
            Aggiorna statistiche
          </button>
        </p>
      )}
      {!stats && !error && <p role="status">Caricamento statistiche…</p>}
      {stats && (
        <>
          <div className="wrapped-metrics">
            <article>
              <strong>
                {Math.floor(stats.seconds / 60).toLocaleString('it-IT')}
              </strong>
              <span>Minuti ascoltati</span>
            </article>
            <article>
              <strong>{stats.plays.toLocaleString('it-IT')}</strong>
              <span>Ascolti</span>
            </article>
            <article>
              <strong>{stats.distinctArtists}</strong>
              <span>Artisti</span>
            </article>
            <article>
              <strong>{stats.activeDays}</strong>
              <span>Giorni con musica</span>
            </article>
          </div>
          {!stats.seconds && (
            <section className="library-empty">
              <Icon name="pulse" size={36} />
              <h3>Il tuo anno comincia con un brano</h3>
              <p>
                Da ora misuriamo i tuoi ascolti. La vecchia cronologia non
                contiene minuti verificabili.
              </p>
              <button className="primary-play-btn" onClick={() => onSearch('')}>
                Trova qualcosa da ascoltare
              </button>
            </section>
          )}
          {!!stats.seconds && (
            <div className="wrapped-columns">
              <section className="profile-card">
                <h2>I tuoi brani</h2>
                <ol className="wrapped-ranking">
                  {stats.topTracks
                    .slice(0, 10)
                    .map(({ track, seconds, plays }, i) => (
                      <li key={track.id}>
                        <span className="rank">{i + 1}</span>
                        <button
                          onClick={() => onPlay(track)}
                          aria-label={`Riascolta dalla classifica ${track.title}`}
                        >
                          <CoverArt
                            src={track.artworkUrl}
                            title={track.title}
                          />
                          <span>
                            <strong>{track.title}</strong>
                            <small>
                              {track.artist} · {Math.floor(seconds / 60)} min ·{' '}
                              {plays} ascolti
                            </small>
                          </span>
                          <Icon name="play" size={18} />
                        </button>
                      </li>
                    ))}
                </ol>
              </section>
              <section className="profile-card">
                <h2>I tuoi artisti</h2>
                <ol className="wrapped-ranking artist-ranking">
                  {stats.topArtists
                    .slice(0, 10)
                    .map(({ artist, seconds }, i) => (
                      <li key={artist}>
                        <span className="rank">{i + 1}</span>
                        <button onClick={() => onSearch(artist)}>
                          <span>
                            <strong>{artist}</strong>
                            <small>{Math.floor(seconds / 60)} minuti</small>
                          </span>
                          <Icon name="arrow" size={18} />
                        </button>
                      </li>
                    ))}
                </ol>
              </section>
            </div>
          )}
          {!!stats.months.length && (
            <section className="profile-card">
              <h2>Il ritmo del tuo anno</h2>
              <div className="listening-months">
                {stats.months.map((m) => (
                  <button
                    key={m.month}
                    aria-label={`${m.month}: ${Math.floor(m.seconds / 60)} minuti. Apri mese`}
                    onClick={() => setMonth(Number(m.month.slice(5)))}
                  >
                    <span>{Math.floor(m.seconds / 60)} min</span>
                    <span
                      className="month-bar"
                      style={{
                        height: `${Math.max(4, (m.seconds / max) * 120)}px`,
                      }}
                    />
                    <small>
                      {new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(
                        'it-IT',
                        { month: 'short', timeZone: 'UTC' },
                      )}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {accountId && (
            <div className="profile-card">
              <h2>Le tue statistiche, sotto il tuo controllo</h2>
              {clearing ? (
                <>
                  <p>
                    Eliminare tutte le statistiche, per tutti gli anni? Questa
                    azione non cambia la libreria.
                  </p>
                  <div className="profile-actions">
                    <button
                      onClick={() => {
                        void accountRequest(
                          '/api/me/stats',
                          undefined,
                          'DELETE',
                        )
                          .then(() => {
                            setClearing(false);
                            setRefresh((v) => v + 1);
                          })
                          .catch(() =>
                            setError('Impossibile eliminare le statistiche.'),
                          );
                      }}
                    >
                      Elimina definitivamente le statistiche
                    </button>
                    <button onClick={() => setClearing(false)}>Annulla</button>
                  </div>
                </>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setClearing(true)}
                >
                  Elimina statistiche di ascolto
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
