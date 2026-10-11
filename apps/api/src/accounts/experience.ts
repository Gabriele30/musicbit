import type { DatabaseSync } from 'node:sqlite';
import {
  cleanLibrary,
  emptyLibrary,
  summarizeListening,
  type ListeningAggregate,
  type ListeningEvent,
  type PlaybackEnvelope,
  type PlaybackSnapshot,
} from '@musicbit/shared';
import { AccountError } from './store.js';

export class ExperienceRepository {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS playback_sessions(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL, body TEXT NOT NULL, device_id TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS listening_receipts(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(user_id,event_id));
      CREATE INDEX IF NOT EXISTS listening_receipts_at ON listening_receipts(at);
      CREATE TABLE IF NOT EXISTS listening_daily(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, track_id TEXT NOT NULL, track TEXT NOT NULL, seconds REAL NOT NULL, plays INTEGER NOT NULL, completed INTEGER NOT NULL, PRIMARY KEY(user_id,day,track_id));
      CREATE TABLE IF NOT EXISTS listening_resets(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, at INTEGER NOT NULL);
      PRAGMA user_version=2;
    `);
  }
  playback(id: string): PlaybackEnvelope {
    const row = this.db
      .prepare('SELECT * FROM playback_sessions WHERE user_id=?')
      .get(id) as
      | {
          revision: number;
          body: string;
          device_id: string;
          updated_at: number;
        }
      | undefined;
    return row
      ? {
          revision: row.revision,
          session: JSON.parse(row.body),
          deviceId: row.device_id,
          updatedAt: row.updated_at,
        }
      : { revision: 0, session: null, deviceId: '', updatedAt: 0 };
  }
  savePlayback(
    id: string,
    revision: number,
    session: PlaybackSnapshot,
    deviceId: string,
  ) {
    const clean = {
      ...session,
      queue: cleanLibrary({ ...emptyLibrary(), favorites: session.queue })
        .favorites,
    };
    const body = JSON.stringify({
      queue: clean.queue,
      index: clean.index,
      position: clean.position,
      repeat: clean.repeat,
      autoplay: clean.autoplay ?? true,
    });
    const result =
      revision === 0
        ? this.db
            .prepare(
              'INSERT OR IGNORE INTO playback_sessions VALUES(?,1,?,?,?)',
            )
            .run(id, body, deviceId, Date.now())
        : this.db
            .prepare(
              'UPDATE playback_sessions SET revision=revision+1,body=?,device_id=?,updated_at=? WHERE user_id=? AND revision=?',
            )
            .run(body, deviceId, Date.now(), id, revision);
    if (!result.changes)
      throw new AccountError(
        409,
        'PLAYBACK_CONFLICT',
        'L’ascolto è cambiato su un altro dispositivo. Scegli dove continuare.',
      );
    return this.playback(id);
  }
  record(id: string, events: ListeningEvent[]) {
    const now = Date.now();
    if (events.some((e) => e.at < now - 7 * 86400000 || e.at > now + 60000))
      throw new AccountError(
        400,
        'INVALID_LISTENING_TIME',
        'Gli ascolti devono risalire agli ultimi sette giorni.',
      );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('DELETE FROM listening_receipts WHERE at<?')
        .run(now - 8 * 86400000);
      const receipt = this.db.prepare(
        'INSERT OR IGNORE INTO listening_receipts VALUES(?,?,?)',
      );
      const add = this.db.prepare(
        `INSERT INTO listening_daily VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,day,track_id) DO UPDATE SET seconds=seconds+excluded.seconds,plays=plays+excluded.plays,completed=completed+excluded.completed,track=excluded.track`,
      );
      const reset = this.db
        .prepare('SELECT at FROM listening_resets WHERE user_id=?')
        .get(id) as { at: number } | undefined;
      for (const event of events) {
        if (reset && event.at <= reset.at) continue;
        if (!receipt.run(id, event.id, event.at).changes) continue;
        const track = cleanLibrary({
          ...emptyLibrary(),
          favorites: [event.track],
        }).favorites[0]!;
        add.run(
          id,
          new Date(event.at).toISOString().slice(0, 10),
          track.id,
          JSON.stringify(track),
          event.seconds,
          event.starts,
          Number(event.completed),
        );
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true };
  }
  stats(id: string, from: string, to: string) {
    const rows = this.db
      .prepare(
        'SELECT day,track,seconds,plays,completed FROM listening_daily WHERE user_id=? AND day>=? AND day<=?',
      )
      .all(id, from, to) as {
      day: string;
      track: string;
      seconds: number;
      plays: number;
      completed: number;
    }[];
    return summarizeListening(
      rows.map(
        (r): ListeningAggregate => ({ ...r, track: JSON.parse(r.track) }),
      ),
      from,
      to,
    );
  }
  clearStats(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'INSERT INTO listening_resets VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET at=excluded.at',
        )
        .run(id, Date.now());
      this.db.prepare('DELETE FROM listening_daily WHERE user_id=?').run(id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    // Keep recent receipts so a delayed retry cannot recreate deleted statistics.
  }
}
