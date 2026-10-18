export function InfiniteListening({
  enabled,
  repeating,
  onToggle,
}: {
  enabled: boolean;
  repeating: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="autoplay-setting">
      <div>
        <strong>Ascolto infinito</strong>
        <small>
          {repeating
            ? 'Disattiva Ripeti per continuare con nuovi brani.'
            : enabled
              ? 'La musica continua e si adatta ad ascolti, preferiti e skip.'
              : 'Attivalo per continuare con nuovi brani dopo la coda.'}
        </small>
      </div>
      <button
        role="switch"
        aria-label="Ascolto infinito"
        aria-checked={enabled}
        onClick={onToggle}
      >
        <span />
      </button>
    </div>
  );
}
