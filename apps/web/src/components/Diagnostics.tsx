import {
  PLAYBACK_REVISION,
  type PlaybackAttempt,
  type PlayerEngine,
  type PlayerState,
} from '../player/engine';
import { Icon } from './Icon';
import { PreparationControls } from './PreparationControls';

const elapsed = (end: number | undefined, start: number) =>
  end === undefined ? '—' : `${Math.max(0, end - start).toFixed(1)} ms`;
export function Diagnostics({
  state,
  player,
}: {
  state: PlayerState;
  player: PlayerEngine;
}) {
  const attempt = state.attempts.at(-1);
  const catalog = state.catalog;
  const prepared = state.preparation;
  const network = state.networkTimings.at(-1);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([player.exportDiagnostics()], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `musicbit-diagnostics-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const values: [string, keyof PlaybackAttempt][] = [
    ['Comando sorgente', 'requestIssuedAt'],
    ['Richiesta · loadstart', 'loadstartAt'],
    ['Primi dati · loadeddata', 'firstDataAt'],
    ['Primo playing', 'playingAt'],
  ];
  return (
    <section className="diagnostics" aria-labelledby="diagnostics-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SOTTO IL COFANO</p>
          <h2 id="diagnostics-title">Diagnostica</h2>
        </div>
        <button
          className="secondary-button"
          onClick={download}
          disabled={!state.attempts.length}
        >
          <Icon name="download" size={18} /> Esporta JSON
        </button>
      </div>
      <p className="muted">
        Misure relative al tocco o al comando, con performance.now(). Nessuna
        misura sintetica.
      </p>
      <p className="muted">Revisione player: {PLAYBACK_REVISION}</p>
      {!state.attempts.length && (
        <p role="status" className="banner">
          Nessun tentativo di ascolto registrato in questa finestra. Dopo il
          problema, apri Impostazioni → Diagnostica nella stessa finestra di
          MusicBit, senza ricaricare, per esportare gli eventi dell’ascolto.
        </p>
      )}
      <div className="diagnostic-controls">
        <button
          className="secondary-button"
          disabled={!state.queue.length || state.index === 0}
          onClick={() => player.previous()}
        >
          Precedente
        </button>
        <button
          className="secondary-button"
          disabled={!state.queue.length}
          onClick={() =>
            state.status === 'playing' || state.status === 'loading'
              ? player.pause()
              : player.play()
          }
        >
          {state.status === 'playing' || state.status === 'loading'
            ? 'Pausa'
            : 'Play'}
        </button>
        <button
          className="secondary-button"
          disabled={state.index >= state.queue.length - 1}
          onClick={() => player.next()}
        >
          Successiva
        </button>
        <button
          className="secondary-button"
          disabled={
            state.status !== 'playing' || attempt?.audibleAt !== undefined
          }
          onClick={() => player.markAudible()}
        >
          Suono udito
        </button>
      </div>
      <p className="muted">
        {state.queue[state.index]?.title ?? 'Catalogo in caricamento'} ·{' '}
        {state.status} · {state.position.toFixed(1)} s
      </p>
      <PreparationControls player={player} state={state} />
      <div className="metrics">
        {values.map(([label, field]) => (
          <div className="metric" key={field}>
            <span>{label}</span>
            <strong>
              {attempt
                ? elapsed(attempt[field] as number | undefined, attempt.clickAt)
                : '—'}
            </strong>
          </div>
        ))}
      </div>
      <dl className="capabilities">
        <div>
          <dt>Click → suono udito (manuale)</dt>
          <dd>{attempt ? elapsed(attempt.audibleAt, attempt.clickAt) : '—'}</dd>
        </div>
        <div>
          <dt>API: richiesta → intestazioni</dt>
          <dd>
            {catalog ? elapsed(catalog.headersAt, catalog.startedAt) : '—'}
          </dd>
        </div>
        <div>
          <dt>API: corpo / validazione</dt>
          <dd>
            {catalog?.headersAt !== undefined
              ? `${elapsed(catalog.bodyAt, catalog.headersAt)} / ${catalog.bodyAt !== undefined ? elapsed(catalog.readyAt, catalog.bodyAt) : '—'}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Tempo provider sul server</dt>
          <dd>{catalog?.serverTiming ?? 'Non esposto'}</dd>
        </div>
        <div>
          <dt>Ottenimento stream</dt>
          <dd>URL diretto nel catalogo · nessuna seconda richiesta API</dd>
        </div>
        <div>
          <dt>Preparazione prima del click</dt>
          <dd>
            {prepared
              ? `${prepared.outcome} · ${elapsed(prepared.readyAt ?? prepared.finishedAt, prepared.startedAt)}`
              : 'Non richiesta'}
          </dd>
        </div>
        <div>
          <dt>Stato buffer / rete</dt>
          <dd>
            readyState {state.buffer.readyState} · networkState{' '}
            {state.buffer.networkState}
          </dd>
        </div>
        <div>
          <dt>Buffer avanti / intervalli</dt>
          <dd>
            {state.buffer.ahead.toFixed(2)} s ·{' '}
            {state.buffer.ranges
              .map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`)
              .join(', ') || 'Nessun intervallo esposto'}
          </dd>
        </div>
        <div>
          <dt>Dati decodificati → playing</dt>
          <dd>
            {attempt?.firstDataAt !== undefined
              ? elapsed(attempt.playingAt, attempt.firstDataAt)
              : '— · può essere già preparata'}
          </dd>
        </div>
        <div>
          <dt>Attese waiting osservate</dt>
          <dd>
            {(attempt?.waitingMs ?? 0).toFixed(1)} ms
            {attempt?.waitingAt !== undefined ? ' + attesa in corso' : ''}
          </dd>
        </div>
        <div>
          <dt>HTTP richiesta → intestazioni audio</dt>
          <dd>
            {network?.requestToHeadersMs !== undefined
              ? `${network.requestToHeadersMs.toFixed(1)} ms`
              : 'Non disponibile · TAO assente o richiesta ancora aperta'}
          </dd>
        </div>
        <div>
          <dt>Errori API / player</dt>
          <dd>{catalog?.error ?? state.error ?? 'Nessuno'}</dd>
        </div>
        <div>
          <dt>Pagina / connessione</dt>
          <dd>
            {document.visibilityState} ·{' '}
            {navigator.onLine ? 'online (indicativo)' : 'offline'}
          </dd>
        </div>
        <div>
          <dt>Contesto PWA</dt>
          <dd>
            {window.matchMedia?.('(display-mode: standalone)').matches
              ? 'Standalone'
              : 'Browser'}
          </dd>
        </div>
        <div>
          <dt>Media Session playbackState</dt>
          <dd>{navigator.mediaSession?.playbackState ?? 'Non disponibile'}</dd>
        </div>
      </dl>
      <div className="info-panel">
        <p>
          <strong>Come leggere i tempi</strong>
        </p>
        <p>
          Il comando sorgente precede src/load. loadstart indica l’inizio del
          caricamento osservato dal browser, non l’istante HTTP esatto.
          loadeddata indica dati decodificati, non il primo byte di rete. Alla
          ripresa i dati possono essere già nel buffer; i campi mancanti restano
          “—”. Le sorgenti esterne possono non esporre Resource Timing. Il primo
          playing è un segnale del browser, non una prova di suono fisico.
          “Suono udito” è una misura manuale che include la tua reazione.
          Resource Timing può arrivare solo a richiesta conclusa; senza
          Timing-Allow-Origin non possiamo separare rete e server remoto. Il
          totale waiting include anche eventuali rebuffer successivi. Un vuoto
          nel log in background non dimostra da solo una sospensione.
        </p>
      </div>
      <dl className="capabilities">
        <div>
          <dt>Contesto sicuro</dt>
          <dd>{window.isSecureContext ? 'Sì' : 'No · usa HTTPS'}</dd>
        </div>
        <div>
          <dt>Media Session</dt>
          <dd>{state.mediaSession ? 'API presente' : 'Non disponibile'}</dd>
        </div>
        <div>
          <dt>Azioni registrate</dt>
          <dd>{state.mediaActions.join(', ') || 'Nessuna'}</dd>
        </div>
        <div>
          <dt>Ultimo avvio</dt>
          <dd>
            {attempt ? `${attempt.kind} · ${attempt.trigger}` : 'Nessuno'}
          </dd>
        </div>
      </dl>
      <div className="device-note">
        <Icon name="pulse" />
        <p>
          <strong>iPhone e CarPlay: da verificare</strong>
          <br />
          La presenza dell’API non prova il funzionamento a schermo bloccato o
          in auto. Usa la checklist nel repository.
        </p>
      </div>
      <h3>Ultimi avvii</h3>
      {state.attempts.length === 0 ? (
        <p className="muted">Avvia una traccia per registrare i tempi.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Traccia</th>
                <th>Origine</th>
                <th>Richiesta</th>
                <th>Dati</th>
                <th>Playing</th>
                <th>Esito</th>
              </tr>
            </thead>
            <tbody>
              {[...state.attempts].reverse().map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>
                    {item.trigger} / {item.kind}
                  </td>
                  <td>{elapsed(item.loadstartAt, item.clickAt)}</td>
                  <td>{elapsed(item.firstDataAt, item.clickAt)}</td>
                  <td>{elapsed(item.playingAt, item.clickAt)}</td>
                  <td>
                    {item.error ??
                      (item.cancelledAt !== undefined
                        ? 'Annullato'
                        : item.playingAt !== undefined
                          ? 'Avviato'
                          : 'In attesa / interrotto')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>Eventi audio e visibilità ({state.events.length})</summary>
        <ol className="event-log">
          {[...state.events].reverse().map((item, i) => (
            <li key={`${item.at}-${i}`}>
              <code>{item.at.toFixed(1)} ms</code> {item.event}{' '}
              <span className="muted">
                {item.visibility} · {item.trackId} · {item.position.toFixed(1)}{' '}
                s · ready {item.readyState} / net {item.networkState}
                {item.persisted ? ' · bfcache' : ''}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
