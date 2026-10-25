import { createClientId } from '../client-id';

/** A browser window keeps its playback identity across reloads. */
export function playbackDeviceId() {
  try {
    const key = 'musicbit.device.v1';
    const old = sessionStorage.getItem(key);
    if (old && /^[a-zA-Z0-9_-]{8,100}$/.test(old)) return old;
    const id = createClientId();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return createClientId();
  }
}
