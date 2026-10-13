import { useEffect, useState } from 'react';
import type { SpotifyChart } from '@musicbit/shared';
import { accountRequest } from '../account';
import { Icon } from './Icon';

export function Charts({
  active,
  onSearch,
}: {
  active: boolean;
  onSearch: (query: string) => void;
}) {
  const [market, setMarket] = useState<SpotifyChart['market']>('it');
  const [chart, setChart] = useState<SpotifyChart>();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setChart(undefined);
    setError(false);
    setExpanded(false);
    void accountRequest<SpotifyChart>(
      `/api/charts/spotify?market=${market}`,
      undefined,
      'GET',
      controller.signal,
    )
      .then((data) => {
        if (
          data.market !== market ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
          !Array.isArray(data.entries) ||
          !data.entries.every(
            (e) =>
              typeof e.title === 'string' &&
              typeof e.artist === 'string' &&
              Number.isInteger(e.position) &&
              Number.isFinite(e.streams) &&
              /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/.test(
                e.spotifyUrl,
              ),
          )
        )
          throw new Error('Invalid chart');
        if (!controller.signal.aborted) setChart(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [active, market, refresh]);
  return (
    <section
      className="feed-section spotify-charts"
      aria-label="Classifica Spotify"
    >
      <h2>Classifica</h2>
      <div
        className="catalog-filters"
        role="group"
        aria-label="Paese della classifica"
      >
        <button aria-pressed={market === 'it'} onClick={() => setMarket('it')}>
          Italia
        </button>
        <button
          aria-pressed={market === 'global'}
          onClick={() => setMarket('global')}
        >
          Global
        </button>
      </div>
      {chart && (
        <>
          <p className="muted">
            Spotify Daily ·{' '}
            {new Date(`${chart.date}T00:00:00Z`).toLocaleDateString('it-IT', {
              timeZone: 'UTC',
            })}{' '}
            · Dati{' '}
            <a
              href={`https://kworb.net/spotify/country/${market}_daily.html`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Kworb
            </a>
            {chart.stale && ' · Rilevamento non recente'}
          </p>
          <ol className="chart-tracks">
            {chart.entries.slice(0, expanded ? 20 : 10).map((entry) => (
              <li key={entry.position}>
                <span className="chart-position">
                  {entry.position}
                  <small>{entry.change}</small>
                </span>
                <button
                  onClick={() =>
                    onSearch(`${entry.title} ${entry.artist}`.slice(0, 120))
                  }
                  aria-label={`Cerca in MusicBit ${entry.title} di ${entry.artist}`}
                >
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.artist}</small>
                    <small>
                      {entry.streams.toLocaleString('it-IT')} stream nel giorno
                    </small>
                  </span>
                  <Icon name="search" size={18} />
                </button>
                <a
                  href={entry.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Apri ${entry.title} su Spotify`}
                >
                  ↗
                </a>
              </li>
            ))}
          </ol>
          {chart.entries.length > 10 && (
            <button
              className="text-button"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Mostra Top 10' : 'Mostra Top 20'}
            </button>
          )}
          <p className="muted">
            Tocca un brano per cercarlo e ascoltarlo in MusicBit.
          </p>
        </>
      )}
      {!chart && !error && (
        <p role="status" className="muted">
          Caricamento classifica Spotify…
        </p>
      )}
      {error && (
        <p role="status" className="muted">
          Classifica momentaneamente non disponibile.{' '}
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Riprova
          </button>
        </p>
      )}
      <div className="chart-links">
        <a
          href="https://charts.spotify.com/charts/view/regional-it-daily/latest"
          target="_blank"
          rel="noopener noreferrer"
        >
          <strong>Top Italia</strong>
          <span>Classifica ufficiale Spotify ↗</span>
        </a>
        <a
          href="https://charts.spotify.com/charts/view/regional-global-daily/latest"
          target="_blank"
          rel="noopener noreferrer"
        >
          <strong>Top Global</strong>
          <span>Classifica ufficiale Spotify ↗</span>
        </a>
      </div>
    </section>
  );
}
