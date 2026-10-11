import { isTracksResponse, PLAYBACK_QUEUE_LIMIT } from '@musicbit/shared';
import type { PlayerEngine, SavedSession } from './engine';

export const SESSION_KEY = 'musicbit.session.v1';

function readSession(
  storage: Storage,
  key = SESSION_KEY,
): SavedSession | undefined {
  const raw = storage.getItem(key);
  if (!raw || raw.length > 5_000_000) return;
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object') return;
  const session = data as SavedSession & { version: unknown };
  if (
    session.version !== 1 ||
    !Array.isArray(session.queue) ||
    !session.queue.length ||
    session.queue.length > PLAYBACK_QUEUE_LIMIT ||
    !session.queue.every(
      (track) =>
        isTracksResponse({ provider: 'session', tracks: [track] }) &&
        (track.durationSeconds === undefined ||
          (Number.isFinite(track.durationSeconds) &&
            track.durationSeconds > 0)),
    ) ||
    !Number.isInteger(session.index) ||
    session.index < 0 ||
    session.index >= session.queue.length ||
    !Number.isFinite(session.position) ||
    session.position < 0 ||
    !['off', 'all', 'one'].includes(session.repeat)
  )
    return;
  return {
    queue: session.queue,
    index: session.index,
    position: session.position,
    repeat: session.repeat,
    autoplay: typeof session.autoplay === 'boolean' ? session.autoplay : true,
  };
}

/** Store metadata only. Restoring never loads media or calls play. */
export function connectSessionPersistence(
  player: PlayerEngine,
  providedStorage?: Storage,
  key = SESSION_KEY,
) {
  let storage: Storage;
  try {
    storage = providedStorage ?? window.localStorage;
    const session = readSession(storage, key);
    if (session) player.restoreSession(session);
  } catch {
    // Private browsing, full storage or corrupt JSON must never disable playback.
    try {
      storage = providedStorage ?? window.localStorage;
    } catch {
      return () => {};
    }
  }
  let previous = player.getSnapshot();
  const save = () => {
    const { queue, index, position, repeat, autoplay } = player.getSnapshot();
    if (!queue.length) return;
    try {
      storage.setItem(
        key,
        JSON.stringify({
          version: 1,
          queue,
          index,
          position,
          repeat,
          autoplay,
        }),
      );
    } catch {
      /* Listening remains available when storage is full or blocked. */
    }
  };
  const unsubscribe = player.subscribe(() => {
    const next = player.getSnapshot();
    const changed =
      next.queue !== previous.queue ||
      next.index !== previous.index ||
      next.repeat !== previous.repeat ||
      next.autoplay !== previous.autoplay ||
      next.status !== previous.status ||
      Math.floor(next.position / 5) !== Math.floor(previous.position / 5);
    previous = next;
    if (changed) save();
  });
  const hidden = () => {
    if (document.visibilityState === 'hidden') save();
  };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    save();
    unsubscribe();
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', hidden);
  };
}
