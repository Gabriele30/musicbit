import { useEffect, useState } from 'react';
import {
  isLocalLibrary,
  type AccountProfile,
  type LibraryEnvelope,
} from '@musicbit/shared';

export class AccountRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let activeAccountId: string | undefined;
export async function accountRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-MusicBit-Request': '1',
        ...(path.startsWith('/api/me/') && activeAccountId
          ? { 'X-MusicBit-Account': activeAccountId }
          : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new AccountRequestError(
        response.status,
        data.code ?? 'ACCOUNT_ERROR',
        data.error ?? 'Operazione non riuscita. Riprova.',
      );
    return data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function fetchAccountLibrary(
  signal?: AbortSignal,
): Promise<LibraryEnvelope> {
  const data = await accountRequest<LibraryEnvelope>(
    '/api/me/library',
    undefined,
    'GET',
    signal,
  );
  if (
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    !isLocalLibrary(data.library)
  )
    throw new Error('La risposta della libreria non è valida.');
  return data;
}
export function useAccount() {
  const [user, setUser] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void accountRequest<{
      user: AccountProfile | null;
      registrationEnabled: boolean;
    }>('/api/auth/session', undefined, 'GET', controller.signal)
      .then((data) => {
        activeAccountId = data.user?.id;
        setUser(data.user);
        setRegistrationEnabled(data.registrationEnabled);
        setError('');
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Account non raggiungibile. Puoi continuare con la libreria di questo dispositivo.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const signIn = async (
    username: string,
    password: string,
    register = false,
  ) => {
    const data = await accountRequest<{ user: AccountProfile }>(
      `/api/auth/${register ? 'register' : 'login'}`,
      { username, password },
    );
    setUser(data.user);
    activeAccountId = data.user.id;
    setError('');
  };
  const signOut = async () => {
    await accountRequest('/api/auth/logout', {});
    setUser(null);
    activeAccountId = undefined;
  };
  const updateProfile = async (displayName: string, color: string) => {
    const data = await accountRequest<{ user: AccountProfile }>(
      '/api/me/profile',
      { displayName, color },
      'PUT',
    );
    setUser(data.user);
  };
  return {
    user,
    loading,
    error,
    registrationEnabled,
    signIn,
    signOut,
    updateProfile,
  };
}
export type AccountModel = ReturnType<typeof useAccount>;
