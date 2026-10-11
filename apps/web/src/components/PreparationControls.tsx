import type { PlayerEngine, PlayerState } from '../player/engine';

export function PreparationControls({
  player,
  state,
}: {
  player: PlayerEngine;
  state: PlayerState;
}) {
  const preparing = state.preparation?.outcome === 'loading';
  const ready = state.preparation?.outcome === 'ready';
  return (
    <div className="preparation-controls">
      <button
        className="secondary-button"
        disabled={
          !state.queue.length ||
          state.status === 'playing' ||
          state.status === 'loading' ||
          preparing
        }
        onClick={() => player.prepare()}
      >
        Prepara traccia
      </button>
      {(preparing || ready) && (
        <button
          className="secondary-button"
          onClick={() => player.cancelPreparation()}
        >
          Annulla preparazione
        </button>
      )}
      <p className="muted">
        {preparing
          ? 'Preparazione in corso…'
          : ready
            ? 'Dati pronti nel browser. Tocca Play.'
            : 'Facoltativo, a player fermo: ricarica dall’inizio e può scaricare l’intero file audio. Nessun autoplay.'}
      </p>
    </div>
  );
}
