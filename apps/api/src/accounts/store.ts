import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ExperienceRepository } from './experience.js';
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import {
  emptyLibrary,
  type AccountProfile,
  type LibraryEnvelope,
  type LocalLibrary,
} from '@musicbit/shared';

const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((done, fail) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, v) => (e ? fail(e) : done(v)),
    ),
  );
type UserRow = {
  id: string;
  username: string;
  display_name: string;
  color: string;
  created_at: number;
  password_hash: string;
  salt: string;
};
const profile = (r: UserRow): AccountProfile => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  color: r.color,
  createdAt: r.created_at,
});
export class AccountError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class AccountStore {
  private db: DatabaseSync;
  readonly experience: ExperienceRepository;
  private dummySalt = randomBytes(16).toString('hex');
  constructor(path = ':memory:') {
    if (path !== ':memory:')
      mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    const version = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version.user_version > 2) {
      this.db.close();
      throw new Error(
        'Account database schema is newer than this MusicBit version.',
      );
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, color TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS libraries(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, updated_at INTEGER NOT NULL);
      `);
    this.experience = new ExperienceRepository(this.db);
  }
  close() {
    this.db.close();
  }
  async createUser(username: string, password: string, seeded = false) {
    const normalized = username.trim().toLowerCase();
    if (
      !/^[a-z0-9_]{3,32}$/.test(normalized) ||
      password.length > 128 ||
      password.length < (seeded ? 1 : 8)
    )
      throw new AccountError(
        400,
        'INVALID_ACCOUNT',
        'Usa un nome di 3–32 lettere, numeri o underscore e una password di almeno 8 caratteri.',
      );
    if (
      this.db.prepare('SELECT id FROM users WHERE username=?').get(normalized)
    )
      throw new AccountError(
        409,
        'USERNAME_TAKEN',
        'Questo nome utente è già utilizzato.',
      );
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password, salt)).toString('hex');
    const id = randomUUID();
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (
        Number(
          (
            this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as {
              n: number;
            }
          ).n,
        ) >= 100
      )
        throw new AccountError(
          409,
          'ACCOUNT_LIMIT',
          'Limite di account raggiunto.',
        );
      this.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)')
        .run(id, normalized, username.trim(), '#d6f68a', hash, salt, now);
      this.db
        .prepare('INSERT INTO libraries VALUES(?,0,?,?)')
        .run(id, JSON.stringify(emptyLibrary()), now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      if (e instanceof AccountError) throw e;
      throw new AccountError(
        409,
        'USERNAME_TAKEN',
        'Questo nome utente è già utilizzato.',
      );
    }
    return this.getProfile(id)!;
  }
  getProfile(id: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as
      | UserRow
      | undefined;
    return row ? profile(row) : undefined;
  }
  async authenticate(username: string, password: string) {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username=?')
      .get(username.trim().toLowerCase()) as UserRow | undefined;
    const actual = await derive(password, row?.salt ?? this.dummySalt);
    if (!row || !timingSafeEqual(actual, Buffer.from(row.password_hash, 'hex')))
      throw new AccountError(
        401,
        'INVALID_CREDENTIALS',
        'Nome utente o password non corretti.',
      );
    return profile(row);
  }
  createSession(id: string) {
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    // Bound sessions per account, retaining the 20 most recently created.
    this.db
      .prepare(
        'DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 19)',
      )
      .run(id, id);
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(hashToken(token), id, now + 30 * 86400000);
    return token;
  }
  session(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = this.db
      .prepare(
        'SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',
      )
      .get(hashToken(token), Date.now()) as { user_id: string } | undefined;
    return row ? this.getProfile(row.user_id) : undefined;
  }
  logout(token: string) {
    this.db
      .prepare('DELETE FROM sessions WHERE token_hash=?')
      .run(hashToken(token));
  }
  updateProfile(id: string, displayName: string, color: string) {
    this.db
      .prepare('UPDATE users SET display_name=?, color=? WHERE id=?')
      .run(displayName.trim(), color, id);
    return this.getProfile(id)!;
  }
  async changePassword(id: string, oldPassword: string, password: string) {
    await this.authenticate(this.getProfile(id)!.username, oldPassword);
    if (password.length < 8 || password.length > 128)
      throw new AccountError(
        400,
        'INVALID_PASSWORD',
        'La nuova password deve contenere da 8 a 128 caratteri.',
      );
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password, salt)).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('UPDATE users SET password_hash=?,salt=? WHERE id=?')
        .run(hash, salt, id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  library(id: string): LibraryEnvelope {
    const row = this.db
      .prepare('SELECT revision,body,updated_at FROM libraries WHERE user_id=?')
      .get(id) as { revision: number; body: string; updated_at: number };
    return {
      revision: row.revision,
      library: JSON.parse(row.body) as LocalLibrary,
      updatedAt: row.updated_at,
    };
  }
  saveLibrary(
    id: string,
    revision: number,
    library: LocalLibrary,
  ): LibraryEnvelope {
    const now = Date.now();
    const result = this.db
      .prepare(
        'UPDATE libraries SET body=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?',
      )
      .run(JSON.stringify(library), now, id, revision);
    if (!result.changes)
      throw new AccountError(
        409,
        'LIBRARY_CONFLICT',
        'La libreria è cambiata su un altro dispositivo. Scegli quale versione conservare.',
      );
    return this.library(id);
  }
}
