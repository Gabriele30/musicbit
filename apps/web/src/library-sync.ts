import { useEffect, useRef, useState } from 'react';
import { emptyLibrary, type LibraryEnvelope } from '@musicbit/shared';
import {
  accountRequest,
  AccountRequestError,
  fetchAccountLibrary,
} from './account';
import type { LibraryModel } from './library';

export type SyncStatus =
  | 'loading'
  | 'saved'
  | 'pending'
  | 'offline'
  | 'conflict'
  | 'expired';
interface PendingSync {
  revision: number;
  dirty: boolean;
  conflict?: boolean;
}
/** A revision mismatch requires an explicit choice; no last-writer-wins data loss. */
export function useLibrarySync(library: LibraryModel, accountId?: string) {
  const [status, setStatus] = useState<SyncStatus>(
    accountId ? 'loading' : 'saved',
  );
  const [message, setMessage] = useState('');
  const [remote, setRemote] = useState<LibraryEnvelope>();
  const latest = useRef(library);
  latest.current = library;
  const state = useRef({
    revision: -1,
    synced: '',
    ready: !accountId,
    busy: false,
    conflict: false,
  });
  const initialSnapshot = useRef(JSON.stringify(library.snapshot));
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    let stopped = false;
    const pendingKey = `musicbit.sync.v1:${accountId}`;
    const fail = (error: unknown) => {
      if (stopped) return;
      if (error instanceof AccountRequestError && error.status === 401) {
        setStatus('expired');
        setMessage(
          error.code === 'ACCOUNT_CHANGED'
            ? 'L’account è cambiato in un’altra scheda. Ricarica MusicBit: le modifiche locali restano separate.'
            : 'Sessione scaduta. Accedi di nuovo: le modifiche restano su questo dispositivo.',
        );
      } else {
        setStatus('offline');
        setMessage(
          'Sincronizzazione in attesa. Le modifiche restano su questo dispositivo.',
        );
      }
    };
    const remember = (dirty: boolean) => {
      try {
        localStorage.setItem(
          pendingKey,
          JSON.stringify({
            revision: state.current.revision,
            dirty,
            conflict: state.current.conflict,
          }),
        );
      } catch {
        /* Library reports storage failures separately. */
      }
    };
    const conflict = (value: LibraryEnvelope) => {
      state.current.conflict = true;
      setRemote(value);
      setStatus('conflict');
      setMessage(
        'La libreria è cambiata altrove. Entrambe le versioni sono disponibili nel profilo.',
      );
      remember(true);
    };
    const run = async () => {
      if (stopped || state.current.busy || state.current.conflict) return;
      state.current.busy = true;
      let again = false;
      try {
        if (!state.current.ready) {
          const before = JSON.stringify(latest.current.snapshot);
          const value = await fetchAccountLibrary(controller.signal);
          if (stopped) return;
          let pending: PendingSync | undefined;
          try {
            const candidate = JSON.parse(
              localStorage.getItem(pendingKey) ?? 'null',
            ) as Partial<PendingSync> | null;
            if (
              candidate &&
              Number.isSafeInteger(candidate.revision) &&
              Number(candidate.revision) >= 0 &&
              typeof candidate.dirty === 'boolean' &&
              (candidate.conflict === undefined ||
                typeof candidate.conflict === 'boolean')
            )
              pending = candidate as PendingSync;
          } catch {
            /* Invalid sync metadata cannot authorize an overwrite. */
          }
          state.current.revision = value.revision;
          state.current.ready = true;
          if (
            JSON.stringify(latest.current.snapshot) !== before ||
            before !== initialSnapshot.current ||
            pending?.conflict ||
            (!pending &&
              before !== JSON.stringify(emptyLibrary()) &&
              before !== JSON.stringify(value.library))
          ) {
            conflict(value);
            return;
          }
          if (pending?.dirty) {
            if (pending.revision !== value.revision) {
              conflict(value);
              return;
            }
            state.current.synced = '';
          } else {
            latest.current.replaceLibrary(value.library);
            state.current.synced = JSON.stringify(value.library);
            remember(false);
            setStatus('saved');
            setMessage('');
            return;
          }
        }
        const snapshot = latest.current.snapshot;
        const serialized = JSON.stringify(snapshot);
        if (serialized !== state.current.synced) {
          remember(true);
          setStatus('pending');
          let value: LibraryEnvelope;
          try {
            value = await accountRequest(
              '/api/me/library',
              { revision: state.current.revision, library: snapshot },
              'PUT',
              controller.signal,
            );
          } catch (e) {
            if (e instanceof AccountRequestError && e.status === 409) {
              conflict(await fetchAccountLibrary(controller.signal));
              return;
            }
            throw e;
          }
          if (stopped) return;
          state.current.revision = value.revision;
          state.current.synced = serialized;
          remember(JSON.stringify(latest.current.snapshot) !== serialized);
          again = JSON.stringify(latest.current.snapshot) !== serialized;
        } else {
          const value = await fetchAccountLibrary(controller.signal);
          if (stopped) return;
          if (value.revision !== state.current.revision) {
            // A user edit made while GET was in flight is still a conflict.
            if (JSON.stringify(latest.current.snapshot) !== serialized) {
              conflict(value);
              return;
            }
            latest.current.replaceLibrary(value.library);
            state.current.synced = JSON.stringify(value.library);
            state.current.revision = value.revision;
            remember(false);
          }
        }
        setStatus('saved');
        setMessage('');
      } catch (e) {
        fail(e);
      } finally {
        state.current.busy = false;
        if (again && !stopped && !state.current.conflict)
          queueMicrotask(() => void run());
      }
    };
    refreshRef.current = run;
    void run();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void run();
    }, 15000);
    const resume = () => {
      if (document.visibilityState !== 'hidden') void run();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [accountId, retry]);
  useEffect(() => {
    if (!accountId || !state.current.ready || state.current.conflict) return;
    if (JSON.stringify(library.snapshot) === state.current.synced) return;
    try {
      localStorage.setItem(
        `musicbit.sync.v1:${accountId}`,
        JSON.stringify({ revision: state.current.revision, dirty: true }),
      );
    } catch {
      /* Local library shows storage warning. */
    }
    const timer = setTimeout(() => void refreshRef.current(), 500);
    return () => clearTimeout(timer);
  }, [library.snapshot, accountId]);
  const useRemote = () => {
    if (!remote) return;
    latest.current.replaceLibrary(remote.library);
    state.current.revision = remote.revision;
    state.current.synced = JSON.stringify(remote.library);
    state.current.conflict = false;
    setRemote(undefined);
    setStatus('saved');
    setMessage('');
    try {
      localStorage.setItem(
        `musicbit.sync.v1:${accountId}`,
        JSON.stringify({ revision: remote.revision, dirty: false }),
      );
    } catch {
      /* Reported by library. */
    }
  };
  const keepLocal = () => {
    if (!remote) return;
    state.current.revision = remote.revision;
    state.current.conflict = false;
    state.current.synced = '';
    setRemote(undefined);
    void refreshRef.current();
  };
  return {
    status,
    message,
    remote,
    useRemote,
    keepLocal,
    refresh: () => {
      if (state.current.ready) void refreshRef.current();
      else setRetry((v) => v + 1);
    },
    canSwitch:
      !accountId ||
      (state.current.ready &&
        !state.current.conflict &&
        JSON.stringify(library.snapshot) === state.current.synced),
  };
}
export type LibrarySyncModel = ReturnType<typeof useLibrarySync>;
