import type {
  PlaybackAttempt,
  PlayerEngine,
  PlayerState,
} from '../player/engine';
import { Icon } from './Icon';

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
        <button className="secondary-button" onClick={download}>
          <Icon name="download" size={18} /> Esporta JSON
        </button>
      </div>
      <p className="muted">
        Misure relative al tocco o al comando, con performance.now(). Nessuna
        misura sintetica.
      </p>
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
      <div className="info-panel">
        <p>
          <strong>Come leggere i tempi</strong>
        </p>
        <p>
          Il comando sorgente precede src/load. loadstart indica l’inizio del
          caricamento osservato dal browser, non l’istante HTTP esatto.
          loadeddata indica dati decodificati, non il primo byte di rete. Alla
          ripresa i dati possono essere già nel buffer; i campi mancanti restano
          “—”. Le sorgenti esterne possono non esporre Resource Timing.
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
                      (item.playingAt !== undefined
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
              <span className="muted">{item.visibility}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
