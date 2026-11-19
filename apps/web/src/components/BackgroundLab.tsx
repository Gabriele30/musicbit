import { useEffect, useRef, useState } from 'react';
import type { PlayerEngine } from '../player/engine';
import { telemetry } from '../player/telemetry';

/**
 * Locked-screen transition laboratory for a physical iPhone.
 *
 * Each strategy plays three 20-second clips cut from the account's own cached
 * songs and records, with timestamps, whether the media clock advanced into
 * each later clip while the page was hidden. Nothing here affects playback.
 */
export type LabStrategy = 'hls' | 'mse' | 'preend' | 'ended' | 'loop';
const STRATEGIES: { id: LabStrategy; label: string; detail: string }[] = [
  {
    id: 'hls',
    label: 'A · HLS unico',
    detail: 'Un solo flusso con tre brani: nessun codice al cambio.',
  },
  {
    id: 'mse',
    label: 'B · Buffer unico (MSE)',
    detail: 'I tre brani vengono accodati in anticipo nello stesso buffer.',
  },
  {
    id: 'preend',
    label: 'C · Cambio prima della fine',
    detail:
      'Il brano successivo viene impostato mezzo secondo prima della fine.',
  },
  {
    id: 'ended',
    label: 'D · Cambio a fine brano',
    detail: 'Metodo classico: nuovo brano all’evento di fine.',
  },
  {
    id: 'loop',
    label: 'E · Ciclo senza fine',
    detail: 'Il brano è in loop e viene sostituito al ritorno all’inizio.',
  },
];

interface Progress {
  clip: number;
  position: number;
  hiddenClips: number[];
  maxClip: number;
  events: number;
  error?: string;
}

const clipUrl = (index: number, kind: 'm4a' | 'frag.mp4' = 'm4a') =>
  `/api/me/lab/clip/clip-${index}.${kind}`;

type MediaSourceCtor = typeof MediaSource;
function mediaSourceCtor(): MediaSourceCtor | undefined {
  const scope = window as unknown as {
    ManagedMediaSource?: MediaSourceCtor;
    MediaSource?: MediaSourceCtor;
  };
  return scope.ManagedMediaSource ?? scope.MediaSource;
}

export function BackgroundLab({ player }: { player: PlayerEngine }) {
  const [ready, setReady] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [seconds, setSeconds] = useState(20);
  const [running, setRunning] = useState<LabStrategy>();
  const [progress, setProgress] = useState<Progress>();
  const [results, setResults] = useState<Partial<Record<LabStrategy, string>>>(
    {},
  );
  const cleanup = useRef<() => void>(undefined);
  const runId = useRef(0);

  useEffect(
    () => () => {
      cleanup.current?.();
      player.exitLab();
    },
    [player],
  );

  const load = async () => {
    setReady('loading');
    setMessage('Preparazione delle clip dai tuoi brani in cache…');
    try {
      const response = await fetch('/api/me/lab', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const data = (await response.json()) as {
        seconds?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? 'Non disponibile.');
      setSeconds(data.seconds ?? 20);
      setReady('ready');
      setMessage('');
    } catch (error) {
      setReady('error');
      setMessage(
        error instanceof Error ? error.message : 'Preparazione non riuscita.',
      );
    }
  };

  const stop = () => {
    cleanup.current?.();
    cleanup.current = undefined;
    player.exitLab();
    setRunning(undefined);
    void telemetry.flush();
  };

  /** Must stay synchronous: audio.play() belongs to the tap. */
  const start = (strategy: LabStrategy) => {
    cleanup.current?.();
    const id = ++runId.current;
    const audio = player.enterLab();
    const listeners: [string, EventListener][] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let clip = 0;
    let lastTime = 0;
    let lastSample = 0;
    let swapping = false;
    const state: Progress = {
      clip: 0,
      position: 0,
      hiddenClips: [],
      maxClip: 0,
      events: 0,
    };
    const currentClip = () =>
      strategy === 'hls' || strategy === 'mse'
        ? Math.min(2, Math.floor((audio.currentTime || 0) / seconds))
        : clip;
    const record = (
      ev: string,
      extra: Record<string, string | number> = {},
    ) => {
      state.events++;
      telemetry.record({
        ev: `lab:${strategy}:${ev}`,
        run: id,
        clip: currentClip(),
        pos: audio.currentTime || 0,
        dur: Number.isFinite(audio.duration) ? audio.duration : -1,
        rs: audio.readyState,
        ns: audio.networkState,
        paused: audio.paused,
        ended: audio.ended,
        vis: document.visibilityState,
        err: audio.error?.code ?? null,
        ...extra,
      });
    };
    const publish = () => {
      if (id !== runId.current) return;
      const active = currentClip();
      // Clock progress inside a later clip, sampled while the page was hidden.
      const within =
        strategy === 'hls' || strategy === 'mse'
          ? (audio.currentTime || 0) - active * seconds
          : audio.currentTime || 0;
      if (within > 2 && !audio.paused) {
        state.maxClip = Math.max(state.maxClip, active);
        if (
          active > 0 &&
          document.visibilityState === 'hidden' &&
          !state.hiddenClips.includes(active)
        ) {
          state.hiddenClips = [...state.hiddenClips, active];
          record('hidden-progress', { reached: active });
        }
      }
      state.clip = active;
      state.position = within;
      setProgress({ ...state });
    };
    const on = (event: string, fn: () => void = () => {}) => {
      const listener = () => {
        if (event !== 'timeupdate') record(event);
        else if (Date.now() - lastSample > 2000) {
          lastSample = Date.now();
          record('tick');
        }
        fn();
        publish();
      };
      listeners.push([event, listener]);
      audio.addEventListener(event, listener);
    };
    const metadata = () => {
      try {
        if (typeof MediaMetadata !== 'undefined')
          navigator.mediaSession.metadata = new MediaMetadata({
            title: `Test ${strategy.toUpperCase()} · clip ${currentClip() + 1}/3`,
            artist: 'MusicBit laboratorio',
          });
      } catch {
        /* Optional. */
      }
    };
    const swap = (reason: string) => {
      if (swapping || clip >= 2) {
        if (clip >= 2 && reason === 'ended') record('finished');
        return;
      }
      swapping = true;
      clip++;
      record('swap', { reason, to: clip });
      audio.src = clipUrl(clip);
      audio.play().then(
        () => record('play-resolved'),
        (error: unknown) =>
          record('play-rejected', {
            name: error instanceof Error ? error.name : 'unknown',
          }),
      );
      metadata();
      lastTime = 0;
      swapping = false;
    };
    for (const event of [
      'loadstart',
      'loadedmetadata',
      'canplay',
      'playing',
      'pause',
      'waiting',
      'stalled',
      'suspend',
      'seeking',
      'seeked',
      'emptied',
      'error',
    ])
      on(event);
    on('timeupdate', () => {
      metadata();
      const now = audio.currentTime || 0;
      if (strategy === 'loop' && now + 5 < lastTime) swap('loop-wrap');
      else if (
        strategy === 'preend' &&
        Number.isFinite(audio.duration) &&
        audio.duration - now < 0.5 &&
        !audio.paused
      )
        swap('pre-end');
      lastTime = now;
      // A backup timer: timeupdate can be sparse while hidden.
      if (strategy === 'preend' && Number.isFinite(audio.duration)) {
        const remaining = (audio.duration - now) / (audio.playbackRate || 1);
        if (remaining > 0.3 && remaining < 3) {
          const at = clip;
          timers.push(
            setTimeout(
              () => clip === at && swap('pre-end-timer'),
              (remaining - 0.25) * 1000,
            ),
          );
        }
      }
    });
    on('ended', () => {
      if (strategy === 'ended' || strategy === 'preend') swap('ended');
      else record('finished');
    });
    const visibility = () => {
      record(`visibility-${document.visibilityState}`);
      publish();
    };
    document.addEventListener('visibilitychange', visibility);

    audio.loop = strategy === 'loop';
    audio.preload = 'auto';
    let objectUrl: string | undefined;
    if (strategy === 'hls') audio.src = '/api/me/lab/hls.m3u8';
    else if (strategy === 'mse') {
      const Ctor = mediaSourceCtor();
      if (!Ctor) {
        state.error = 'MediaSource non disponibile in questo browser.';
        setProgress({ ...state });
        record('unsupported');
        return;
      }
      const source = new Ctor();
      // ManagedMediaSource requires an explicit choice about AirPlay.
      (
        audio as HTMLAudioElement & { disableRemotePlayback?: boolean }
      ).disableRemotePlayback = true;
      objectUrl = URL.createObjectURL(source);
      audio.src = objectUrl;
      source.addEventListener('sourceopen', () => {
        void (async () => {
          try {
            const buffer = source.addSourceBuffer(
              'audio/mp4; codecs="mp4a.40.2"',
            );
            buffer.mode = 'sequence';
            for (let index = 0; index < 3; index++) {
              const response = await fetch(clipUrl(index, 'frag.mp4'), {
                credentials: 'same-origin',
              });
              const bytes = await response.arrayBuffer();
              if (id !== runId.current) return;
              await new Promise<void>((resolve, reject) => {
                buffer.addEventListener('updateend', () => resolve(), {
                  once: true,
                });
                buffer.addEventListener(
                  'error',
                  () => reject(new Error('append')),
                  {
                    once: true,
                  },
                );
                buffer.appendBuffer(bytes);
              });
              record('appended', { index });
            }
            source.endOfStream();
          } catch (error) {
            state.error = 'MSE: accodamento non riuscito.';
            record('append-failed', {
              name: error instanceof Error ? error.message : 'unknown',
            });
            setProgress({ ...state });
          }
        })();
      });
    } else audio.src = clipUrl(0);
    record('start', { ua: navigator.userAgent.slice(0, 160) });
    record(
      `mode-${window.matchMedia?.('(display-mode: standalone)').matches ? 'standalone' : 'browser'}`,
    );
    audio.play().then(
      () => record('play-resolved'),
      (error: unknown) =>
        record('play-rejected', {
          name: error instanceof Error ? error.name : 'unknown',
        }),
    );
    metadata();
    setRunning(strategy);
    setProgress({ ...state });
    cleanup.current = () => {
      timers.forEach(clearTimeout);
      listeners.forEach(([event, listener]) =>
        audio.removeEventListener(event, listener),
      );
      document.removeEventListener('visibilitychange', visibility);
      const summary = `${state.maxClip + 1}/3 clip raggiunte · in background: ${
        state.hiddenClips.length
          ? state.hiddenClips.map((c) => c + 1).join(', ')
          : 'nessuna'
      }`;
      record('summary', {
        maxClip: state.maxClip,
        hidden: state.hiddenClips.join(','),
      });
      setResults((current) => ({ ...current, [strategy]: summary }));
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
    };
  };

  const heard = (strategy: LabStrategy, answer: string) => {
    telemetry.record({ ev: `lab:${strategy}:heard`, answer });
    void telemetry.flush();
    setResults((current) => ({
      ...current,
      [strategy]: `${current[strategy] ?? ''} · udito: ${answer}`,
    }));
  };

  return (
    <section className="lab" aria-labelledby="lab-title">
      <h3 id="lab-title">Test schermo bloccato (iPhone)</h3>
      <p className="muted">
        Per ogni metodo: tocca Avvia, blocca subito l’iPhone e ascolta per circa
        un minuto (tre clip da {seconds} secondi dei tuoi brani). Poi sblocca,
        torna qui, tocca Fine e indica cosa hai sentito. I risultati vengono
        salvati nel tuo account per l’analisi.
      </p>
      {ready !== 'ready' ? (
        <button
          className="secondary-button"
          onClick={() => void load()}
          disabled={ready === 'loading'}
        >
          Prepara il test
        </button>
      ) : (
        <ol className="lab-strategies">
          {STRATEGIES.map((strategy) => (
            <li key={strategy.id}>
              <div>
                <strong>{strategy.label}</strong>
                <span className="muted">{strategy.detail}</span>
                {results[strategy.id] && (
                  <span className="lab-result">{results[strategy.id]}</span>
                )}
              </div>
              {running === strategy.id ? (
                <div className="lab-live">
                  <span role="status">
                    Clip {(progress?.clip ?? 0) + 1}/3 ·{' '}
                    {(progress?.position ?? 0).toFixed(0)} s
                    {progress?.error ? ` · ${progress.error}` : ''}
                  </span>
                  <button className="primary-play-btn" onClick={stop}>
                    Fine
                  </button>
                </div>
              ) : (
                <div className="lab-actions">
                  <button
                    className="secondary-button"
                    disabled={running !== undefined}
                    onClick={() => start(strategy.id)}
                  >
                    Avvia
                  </button>
                  {results[strategy.id] &&
                    !results[strategy.id]!.includes('udito') && (
                      <>
                        <button
                          className="text-button"
                          onClick={() => heard(strategy.id, 'tutte e tre')}
                        >
                          Sentite tutte
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            heard(strategy.id, 'silenzio dopo la prima')
                          }
                        >
                          Silenzio dopo la 1ª
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            heard(strategy.id, 'silenzio dopo la seconda')
                          }
                        >
                          Silenzio dopo la 2ª
                        </button>
                      </>
                    )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
