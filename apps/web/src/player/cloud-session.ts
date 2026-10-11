import { useEffect, useRef, useState } from 'react';
import {
  isPlaybackSnapshot,
  PLAYBACK_QUEUE_LIMIT,
  type PlaybackEnvelope,
  type PlaybackSnapshot,
} from '@musicbit/shared';
import { accountRequest, AccountRequestError } from '../account';
import { createClientId } from '../client-id';
import type { PlayerEngine } from './engine';

const DEVICE_KEY = 'musicbit.device.v1';
function deviceId() {
  try {
    const old = sessionStorage.getItem(DEVICE_KEY);
    if (old && /^[a-zA-Z0-9_-]{8,100}$/.test(old)) return old;
    const id = createClientId();
    sessionStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return createClientId();
  }
}
const snapshot = (player: PlayerEngine): PlaybackSnapshot => {
  const { queue, index, position, repeat, autoplay } = player.getSnapshot();
  return {
    queue: queue.slice(0, PLAYBACK_QUEUE_LIMIT),
    index,
    position,
    repeat,
    autoplay,
  };
};
export function useCloudSession(player: PlayerEngine, accountId?: string) {
  const [remote, setRemote] = useState<PlaybackEnvelope>();
  const [message, setMessage] = useState('');
  const resumeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!accountId) return;
    const device = deviceId(),
      controller = new AbortController();
    let revision: number | undefined,
      latest: PlaybackEnvelope | undefined,
      previous = player.getSnapshot();
    let owning = false,
      dirty = false,
      sending = false,
      disposed = false,
      refreshing = false,
      lastSent = '';
    const apply = (data: PlaybackEnvelope) => {
      if (
        !Number.isSafeInteger(data.revision) ||
        (data.session !== null && !isPlaybackSnapshot(data.session))
      )
        throw new Error('Sessione remota non valida.');
      if (revision !== undefined && data.revision < revision) return;
      const changedElsewhere =
        revision !== undefined &&
        data.revision > revision &&
        data.deviceId !== device;
      revision = data.revision;
      latest = data;
      if (changedElsewhere) {
        owning = false;
        dirty = false;
        setMessage('L’ascolto è aggiornato su un altro dispositivo.');
      } else setMessage('');
      setRemote(data.deviceId !== device && data.session ? data : undefined);
    };
    const refresh = async () => {
      if (disposed || sending || refreshing || controller.signal.aborted)
        return;
      refreshing = true;
      try {
        apply(
          await accountRequest<PlaybackEnvelope>(
            '/api/me/playback',
            undefined,
            'GET',
            controller.signal,
          ),
        );
      } catch {
        if (!disposed)
          setMessage(
            'Ripresa tra dispositivi temporaneamente non disponibile.',
          );
      } finally {
        refreshing = false;
      }
    };
    const publish = async () => {
      if (
        !owning ||
        !dirty ||
        sending ||
        revision === undefined ||
        !navigator.onLine ||
        disposed
      )
        return;
      const session = snapshot(player);
      if (!isPlaybackSnapshot(session)) return;
      const fingerprint = JSON.stringify(session);
      if (fingerprint === lastSent) {
        dirty = false;
        return;
      }
      sending = true;
      dirty = false;
      try {
        const data = await accountRequest<PlaybackEnvelope>(
          '/api/me/playback',
          { revision, session, deviceId: device },
          'PUT',
          controller.signal,
        );
        if (disposed) return;
        revision = data.revision;
        latest = data;
        lastSent = fingerprint;
        setMessage('');
        setRemote(undefined);
      } catch (e) {
        if (disposed) return;
        dirty = true;
        if (e instanceof AccountRequestError && e.status === 409) {
          owning = false;
          dirty = false;
          sending = false;
          await refresh();
          setMessage('Scegli se riprendere l’ascolto dall’altro dispositivo.');
        } else
          setMessage(
            'Coda salvata qui; sincronizzazione in attesa della connessione.',
          );
      } finally {
        sending = false;
      }
    };
    const unsubscribe = player.subscribe(() => {
      const state = player.getSnapshot();
      // A new explicit play command claims this device. Opening the app never does.
      const attempt = state.attempts.at(-1),
        oldAttempt = previous.attempts.at(-1);
      if (attempt?.id !== oldAttempt?.id && attempt?.trigger === 'tap') {
        owning = true;
        dirty = true;
      }
      if (
        owning &&
        (state.queue !== previous.queue ||
          state.index !== previous.index ||
          state.status !== previous.status ||
          state.repeat !== previous.repeat ||
          state.autoplay !== previous.autoplay ||
          Math.floor(state.position / 5) !== Math.floor(previous.position / 5))
      )
        dirty = true;
      previous = state;
    });
    resumeRef.current = () => {
      const session = latest?.session;
      if (!session) return;
      player.resetSession();
      player.restoreSession(session);
      owning = true;
      dirty = true;
      // The remote snapshot is already loaded: play remains inside the tap stack.
      player.play();
      setRemote(undefined);
      void publish();
    };
    const poll = setInterval(() => {
      if (revision === undefined) void refresh().then(publish);
      else {
        if (document.visibilityState === 'visible' && !dirty) void refresh();
        void publish();
      }
    }, 5000);
    const online = () => {
      if (revision === undefined) void refresh().then(publish);
      else void publish();
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') void publish();
      else void refresh();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hide);
    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      unsubscribe();
      clearInterval(poll);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hide);
      resumeRef.current = () => {};
    };
  }, [player, accountId]);
  return { remote, message, resume: () => resumeRef.current() };
}
