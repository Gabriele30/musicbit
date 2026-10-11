import { useState, type FormEvent } from 'react';
import type { AccountModel } from '../account';
import { accountRequest } from '../account';
import { readLibrary, type LibraryModel } from '../library';
import type { LibrarySyncModel } from '../library-sync';
import { downloadBackup, parseBackup } from '../backup';
import { TasteProfile } from './TasteProfile';

const colors = [
  '#d6f68a',
  '#91c9ef',
  '#eeb7d3',
  '#f6c686',
  '#b7a5ee',
  '#85d6bd',
];
export function Profile({
  account,
  library,
  sync,
}: {
  account: AccountModel;
  library: LibraryModel;
  sync: LibrarySyncModel;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(account.user?.displayName ?? '');
  const [color, setColor] = useState(account.user?.color ?? colors[0]!);
  const [imported, setImported] = useState<ReturnType<typeof parseBackup>>();
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Operazione non riuscita. Riprova.',
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      await account.signIn(
        String(data.get('username')),
        String(data.get('password')),
        register,
      );
      form.reset();
    });
  };
  return (
    <div className="profile-page">
      <section className="profile-hero">
        <span
          className="profile-avatar"
          style={{ background: account.user?.color ?? '#d6f68a' }}
          aria-hidden="true"
        >
          {(account.user?.displayName ?? 'M').slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">IL TUO SPAZIO</p>
          <h2>{account.user?.displayName ?? 'La musica ti segue.'}</h2>
          <p className="muted">
            {account.user
              ? `@${account.user.username} · ${library.favorites.length} preferiti · ${library.playlists.length} playlist`
              : 'Accedi per ritrovare la tua libreria su tutti i dispositivi.'}
          </p>
        </div>
      </section>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner" role="status">
          {notice}
        </p>
      )}
      {!account.user ? (
        <section className="profile-card">
          <h2>{register ? 'Crea il tuo account' : 'Bentornato'}</h2>
          <form className="profile-form" onSubmit={submit}>
            <label>
              Nome utente
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={register ? 3 : 1}
                maxLength={32}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 8 : 1}
                maxLength={128}
              />
            </label>
            <button className="primary" disabled={busy || account.loading}>
              {busy ? 'Attendi…' : register ? 'Crea account' : 'Accedi'}
            </button>
          </form>
          {account.registrationEnabled && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setRegister((v) => !v);
                setError('');
              }}
            >
              {register ? 'Hai già un account? Accedi' : 'Crea un account'}
            </button>
          )}
          <p className="muted">
            Senza accesso puoi continuare ad ascoltare. La libreria ospite resta
            su questo dispositivo.
          </p>
          {account.error && <p role="status">{account.error}</p>}
        </section>
      ) : (
        <>
          <section className="profile-card">
            <h2>Il tuo profilo</h2>
            <form
              className="profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await account.updateProfile(name, color);
                  setNotice('Profilo aggiornato.');
                });
              }}
            >
              <label>
                Nome del profilo
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={40}
                  autoComplete="nickname"
                />
              </label>
              <fieldset className="profile-colors">
                <legend>Colore del profilo</legend>
                {colors.map((value) => (
                  <button
                    key={value}
                    type="button"
                    style={{ background: value }}
                    aria-label={`Colore ${value}`}
                    aria-pressed={color === value}
                    onClick={() => setColor(value)}
                  />
                ))}
              </fieldset>
              <button className="secondary" disabled={busy}>
                Salva profilo
              </button>
            </form>
          </section>
          <section className="profile-card">
            <h2>Sincronizzazione</h2>
            <p role="status">
              {
                {
                  loading: 'Caricamento della libreria…',
                  saved: 'Libreria sincronizzata.',
                  pending: 'Salvataggio delle modifiche…',
                  offline:
                    'Modifiche salvate su questo dispositivo. Connessione al server in attesa.',
                  conflict:
                    'Due versioni della libreria richiedono una scelta.',
                  expired:
                    'Sessione scaduta. Le modifiche locali sono conservate.',
                }[sync.status]
              }
            </p>
            <p className="muted">
              Preferiti, playlist, album, artisti, cronologia e preferenze
              personali. La coda di riproduzione rimane separata su ogni
              dispositivo.
            </p>
            {sync.status === 'conflict' && (
              <div className="profile-conflict">
                <p>
                  Esporta le due versioni prima di scegliere: la scelta
                  sostituirà una delle raccolte.
                </p>
                <div className="profile-actions">
                  <button
                    onClick={() =>
                      downloadBackup(library.snapshot, 'versione-locale')
                    }
                  >
                    Esporta versione locale
                  </button>
                  <button
                    onClick={() =>
                      sync.remote &&
                      downloadBackup(sync.remote.library, 'versione-server')
                    }
                  >
                    Esporta versione server
                  </button>
                </div>
                <div className="profile-actions">
                  <button onClick={sync.useRemote}>Usa versione server</button>
                  <button onClick={sync.keepLocal}>
                    Conserva versione locale
                  </button>
                </div>
              </div>
            )}
            <div className="profile-actions">
              <button
                onClick={sync.refresh}
                disabled={sync.status === 'loading'}
              >
                Sincronizza ora
              </button>
              <button
                disabled={busy || sync.status === 'loading'}
                onClick={() =>
                  void run(async () => {
                    await account.signOut();
                  })
                }
              >
                Esci dall’account
              </button>
              {sync.status === 'expired' && (
                <button onClick={() => location.reload()}>
                  Ricarica account
                </button>
              )}
            </div>
          </section>
          <section className="profile-card">
            <h2>Password e accessi</h2>
            <form
              className="profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  await accountRequest('/api/me/password', {
                    currentPassword: String(data.get('currentPassword')),
                    password: String(data.get('password')),
                  });
                  form.reset();
                  setNotice(
                    'Password aggiornata. Gli altri dispositivi dovranno accedere di nuovo.',
                  );
                });
              }}
            >
              <label>
                Password attuale
                <input
                  name="currentPassword"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
              <label>
                Nuova password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <button className="secondary" disabled={busy}>
                Cambia password
              </button>
            </form>
          </section>
        </>
      )}
      <section className="profile-card">
        <h2>La tua musica, al sicuro</h2>
        <p className="muted">
          Il backup contiene la libreria e le preferenze, senza password o file
          audio.
        </p>
        <div className="profile-actions">
          <button
            onClick={() =>
              downloadBackup(
                library.snapshot,
                account.user?.username ?? 'ospite',
              )
            }
          >
            Esporta backup
          </button>
          <label className="file-button">
            Importa backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void run(async () => {
                  if (file.size > 5_000_000)
                    throw new Error('Il backup supera il limite di 5 MB.');
                  setImported(parseBackup(await file.text()));
                });
              }}
            />
          </label>
          {account.user && (
            <button
              onClick={() => {
                const guest = readLibrary();
                setImported(guest);
              }}
            >
              Importa libreria ospite
            </button>
          )}
        </div>
        {imported && (
          <div className="profile-conflict">
            <p>
              Il backup contiene {imported.favorites.length} preferiti,{' '}
              {imported.playlists.length} playlist e {imported.history.length}{' '}
              ascolti. Sostituirà la libreria corrente: esportala prima se vuoi
              conservarla.
            </p>
            <div className="profile-actions">
              <button
                className="primary"
                disabled={sync.status === 'loading'}
                onClick={() => {
                  downloadBackup(library.snapshot, 'prima-importazione');
                  library.replaceLibrary(imported);
                  setImported(undefined);
                  setNotice(
                    'Backup importato. La copia precedente è stata esportata.',
                  );
                }}
              >
                Conferma importazione
              </button>
              <button onClick={() => setImported(undefined)}>Annulla</button>
            </div>
          </div>
        )}
      </section>
      <TasteProfile library={library} />
    </div>
  );
}
