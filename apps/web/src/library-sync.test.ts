import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { emptyLibrary, type LibraryEnvelope } from '@musicbit/shared';
import { LIBRARY_KEY, useLibrary } from './library';
import { useLibrarySync } from './library-sync';
const response = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
function envelope(name: string, revision = 0): LibraryEnvelope {
  const library = emptyLibrary();
  if (name) library.playlists = [{ id: name, name, tracks: [], updatedAt: 1 }];
  return { revision, library, updatedAt: 1 };
}
function setup() {
  return renderHook(() => {
    const library = useLibrary('account-a');
    const sync = useLibrarySync(library, 'account-a');
    return { library, sync };
  });
}
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('account library synchronization', () => {
  it('loads its own library, saves edits with a revision, and leaves guest data alone', async () => {
    const guest = envelope('Guest').library;
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(guest));
    let remote = envelope('Server', 2);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body.revision).toBe(2);
        remote = { ...remote, revision: 3, library: body.library };
      }
      return response(remote);
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = setup();
    await waitFor(() => expect(result.current.sync.status).toBe('saved'));
    expect(result.current.library.playlists[0]?.name).toBe('Server');
    act(() => {
      result.current.library.createPlaylist('New');
    });
    await waitFor(() => expect(remote.revision).toBe(3));
    expect(remote.library.playlists.map((p) => p.name)).toEqual([
      'New',
      'Server',
    ]);
    expect(
      JSON.parse(localStorage.getItem(LIBRARY_KEY)!).playlists[0].name,
    ).toBe('Guest');
  });
  it('preserves an offline conflict through reload and only overwrites after an explicit choice', async () => {
    localStorage.setItem(
      `${LIBRARY_KEY}:account-a`,
      JSON.stringify(envelope('Offline').library),
    );
    localStorage.setItem(
      'musicbit.sync.v1:account-a',
      JSON.stringify({ revision: 2, dirty: true }),
    );
    let remote = envelope('Other device', 3);
    const writes: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          writes.push(body);
          remote = {
            ...remote,
            revision: remote.revision + 1,
            library: body.library,
          };
        }
        return response(remote);
      }),
    );
    const first = setup();
    await waitFor(() =>
      expect(first.result.current.sync.status).toBe('conflict'),
    );
    expect(first.result.current.library.playlists[0]?.name).toBe('Offline');
    first.unmount();
    const second = setup();
    await waitFor(() =>
      expect(second.result.current.sync.status).toBe('conflict'),
    );
    expect(writes).toEqual([]);
    expect(second.result.current.sync.remote?.library.playlists[0]?.name).toBe(
      'Other device',
    );
    act(() => second.result.current.sync.keepLocal());
    await waitFor(() =>
      expect(second.result.current.sync.status).toBe('saved'),
    );
    expect(remote.library.playlists[0]?.name).toBe('Offline');
    expect(writes).toHaveLength(1);
  });
  it('does not discard edits made before the first successful connection', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!online) throw new Error('offline');
        return response(envelope('Remote', 4));
      }),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.sync.status).toBe('offline'));
    act(() => {
      result.current.library.createPlaylist('Local');
    });
    online = true;
    act(() => result.current.sync.refresh());
    await waitFor(() => expect(result.current.sync.status).toBe('conflict'));
    expect(result.current.library.playlists[0]?.name).toBe('Local');
  });
  it('retains the local version when a concurrent save returns 409', async () => {
    let conflict = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === 'PUT'
          ? response({ code: 'LIBRARY_CONFLICT', error: 'Conflict' }, 409)
          : response(
              envelope(conflict ? 'Other device' : '', conflict ? 1 : 0),
            ),
      ),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.sync.status).toBe('saved'));
    conflict = true;
    act(() => {
      result.current.library.createPlaylist('Local');
    });
    await waitFor(() => expect(result.current.sync.status).toBe('conflict'));
    expect(result.current.library.playlists[0]?.name).toBe('Local');
    act(() => result.current.sync.useRemote());
    expect(result.current.library.playlists[0]?.name).toBe('Other device');
  });
});
