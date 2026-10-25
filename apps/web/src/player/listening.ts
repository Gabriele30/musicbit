import { useEffect, useState } from 'react';
import {
  isListeningEvent,
  isListeningAggregate,
  summarizeListening,
  type ListeningAggregate,
  type ListeningEvent,
  type ListeningStats,
  type Track,
} from '@musicbit/shared';
import { accountRequest } from '../account';
import { createClientId } from '../client-id';
import type { PlayerEngine, PlayerState } from './engine';

export const LISTENING_CHANGED = 'musicbit:listening';
const pendingKey = (id: string) => `musicbit.listening.pending.v1:${id}`;
const GUEST_STATS = 'musicbit.listening.guest.v1';
export function readPendingListening(scope: string): ListeningEvent[] {
  try {
    const raw = localStorage.getItem(pendingKey(scope));
    if (!raw || raw.length > 2000000) return [];
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values)
      ? values
          .filter(isListeningEvent)
          .filter((e) => e.at > Date.now() - 7 * 86400000)
          .slice(-1000)
      : [];
  } catch {
    return [];
  }
}
export function guestListeningStats(
  year: number,
  month?: number,
): ListeningStats {
  let rows: ListeningAggregate[] = [];
  try {
    const value = JSON.parse(localStorage.getItem(GUEST_STATS) ?? '[]');
    if (Array.isArray(value)) rows = value.filter(isListeningAggregate);
  } catch {
    /* Empty stats on corrupt or unavailable storage. */
  }
  const from = `${year}-${String(month ?? 1).padStart(2, '0')}-01`,
    to = month
      ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
      : `${year}-12-31`;
  return summarizeListening(rows, from, to);
}
/** Measure native progress against elapsed wall time. Seeking never creates listening minutes. */
export class ListeningMeter {
  private previous: PlayerState | undefined;
  private at = 0;
  private track: Track | undefined;
  private buffered = 0;
  private total = 0;
  private counted = false;
  private finished = false;
  constructor(
    private emit: (event: ListeningEvent) => void,
    private clock = () => performance.now(),
  ) {}
  sample(state: PlayerState, seeking = false) {
    const now = this.clock(),
      current = state.queue[state.index],
      old = this.previous;
    const changed = current?.id !== this.track?.id;
    const newAttempt = state.attempts.at(-1),
      previousAttempt = old?.attempts.at(-1);
    const newPass =
      !changed &&
      Boolean(
        old &&
          (old.index !== state.index ||
            (newAttempt &&
              newAttempt.id !== previousAttempt?.id &&
              (newAttempt.trigger === 'ended' || old.status === 'ended'))),
      );
    if (old && this.track && !changed && !seeking && old.status === 'playing') {
      const delta = state.position - old.position,
        elapsed = Math.max(0, (now - this.at) / 1000);
      const rate = old.playbackRate || 1;
      if (
        delta >= 0 &&
        delta <= elapsed * rate * 1.25 + 0.5 &&
        elapsed < 21600
      ) {
        const heard = Math.min(delta / rate, elapsed);
        this.buffered += heard;
        this.total += heard;
      }
    }
    if (changed || newPass) {
      const completedPrevious = Boolean(
        old &&
          this.track &&
          old.duration > 0 &&
          old.position >= old.duration - 3 &&
          !this.finished,
      );
      this.flush(false, completedPrevious);
      this.track = current;
      this.total = 0;
      this.counted = false;
      this.finished = false;
    }
    const completed = Boolean(
      this.track &&
        state.duration > 0 &&
        state.position >= state.duration - 1 &&
        state.status === 'ended',
    );
    if (
      this.track &&
      this.total >= Math.min(30, (state.duration || 60) / 2) &&
      !this.counted
    ) {
      this.counted = true;
      this.flush(true);
    }
    if (completed && !this.finished) {
      this.finished = true;
      this.flush(false, true);
    }
    if (
      this.buffered >= 15 ||
      (old?.status === 'playing' && state.status !== 'playing')
    )
      this.flush();
    this.previous = state;
    this.at = now;
  }
  flush(starts = false, completed = false) {
    if (!this.track || (this.buffered <= 0 && !starts && !completed)) return;
    let seconds = this.buffered;
    this.buffered = 0;
    do {
      const part = Math.min(60, seconds);
      this.emit({
        id: createClientId(),
        track: this.track,
        at: Date.now(),
        seconds: part,
        starts: starts ? 1 : 0,
        completed,
      });
      seconds -= part;
      starts = false;
      completed = false;
    } while (seconds > 0);
  }
}
export function useListening(player: PlayerEngine, accountId?: string) {
  const [error, setError] = useState('');
  useEffect(() => {
    const scope = accountId ?? 'guest';
    let pending = readPendingListening(scope),
      disposed = false,
      sending = false,
      seeking = false;
    const controller = new AbortController();
    const notify = () => window.dispatchEvent(new Event(LISTENING_CHANGED));
    const save = () => {
      try {
        localStorage.setItem(pendingKey(scope), JSON.stringify(pending));
      } catch {
        setError(
          'Le statistiche non possono essere salvate su questo dispositivo.',
        );
      }
    };
    const send = async () => {
      if (
        !accountId ||
        disposed ||
        sending ||
        !pending.length ||
        !navigator.onLine
      )
        return;
      sending = true;
      const batch = pending.slice(0, 50);
      try {
        await accountRequest(
          '/api/me/listening',
          { events: batch },
          'POST',
          controller.signal,
        );
        if (disposed) return;
        const ids = new Set(batch.map((e) => e.id));
        pending = pending.filter((e) => !ids.has(e.id));
        save();
        setError('');
        notify();
      } catch {
        if (!disposed)
          setError(
            'Statistiche in attesa di sincronizzazione. Saranno inviate quando la connessione torna disponibile.',
          );
      } finally {
        sending = false;
      }
    };
    const meter = new ListeningMeter((event) => {
      if (accountId) {
        if (pending.length >= 1000) {
          setError(
            'Spazio per le statistiche offline esaurito. Connettiti per riprendere la registrazione.',
          );
          return;
        }
        pending = [...pending, event];
        save();
      } else {
        try {
          const raw = JSON.parse(
            localStorage.getItem(GUEST_STATS) ?? '[]',
          ) as ListeningAggregate[];
          const rows = Array.isArray(raw)
              ? raw.filter(isListeningAggregate)
              : [],
            day = new Date(event.at).toISOString().slice(0, 10);
          const row = rows.find(
            (r) => r.day === day && r.track.id === event.track.id,
          );
          if (row) {
            row.seconds += event.seconds;
            row.plays += event.starts;
            row.completed += Number(event.completed);
          } else {
            if (rows.length >= 10000) throw new Error('Guest statistics full');
            rows.push({
              day,
              track: event.track,
              seconds: event.seconds,
              plays: event.starts,
              completed: Number(event.completed),
            });
          }
          localStorage.setItem(GUEST_STATS, JSON.stringify(rows));
          notify();
        } catch {
          setError(
            'Le statistiche non possono essere salvate su questo dispositivo.',
          );
        }
      }
    });
    meter.sample(player.getSnapshot());
    const unsubscribe = player.subscribe(() =>
      meter.sample(player.getSnapshot(), seeking),
    );
    const seek = () => {
      seeking = true;
      meter.sample(player.getSnapshot(), true);
    };
    const sought = () => {
      meter.sample(player.getSnapshot(), true);
      seeking = false;
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        meter.flush();
        void send();
      }
    };
    const pagehide = () => {
      meter.flush();
    };
    const online = () => {
      void send();
    };
    const timer = setInterval(() => {
      meter.flush();
      void send();
    }, 15000);
    player.audio.addEventListener('seeking', seek);
    player.audio.addEventListener('seeked', sought);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('online', online);
    void send();
    return () => {
      meter.flush();
      disposed = true;
      controller.abort();
      unsubscribe();
      clearInterval(timer);
      player.audio.removeEventListener('seeking', seek);
      player.audio.removeEventListener('seeked', sought);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('online', online);
    };
  }, [player, accountId]);
  return error;
}
