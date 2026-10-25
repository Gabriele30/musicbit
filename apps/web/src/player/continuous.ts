import type {
  ContinuousTimeline,
  Track,
  ContinuousTrack,
} from '@musicbit/shared';
import { PLAYBACK_QUEUE_LIMIT } from '@musicbit/shared';
import { accountRequest } from '../account';
import { playbackDeviceId } from './device-id';

/** Controls a single native HLS source, with track-relative UI positions. */
export class ContinuousPlayback {
  private session?: {
    id: string;
    source: string;
    queue: Track[];
    queueStart: number;
    serverQueueStart: number;
    offset: number;
    timeline: ContinuousTimeline;
    controller: AbortController;
    timer?: ReturnType<typeof setTimeout>;
    retry?: ReturnType<typeof setTimeout>;
    retries: number;
    pending: boolean;
    autoplay: boolean;
  };
  enabled = false;
  constructor(
    private changed: () => void,
    private log: (event: string) => void,
    private getTime: () => number = () => Number.POSITIVE_INFINITY,
  ) {}
  configure(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }
  start(queue: Track[], index: number, autoplay = false) {
    if (
      !this.enabled ||
      !queue
        .slice(index)
        .every((track) =>
          /^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(track.audioUrl),
        )
    )
      return;
    this.clear();
    const id = crypto.randomUUID(),
      source = `/api/continuous/${id}/index.m3u8`;
    this.session = {
      id,
      source,
      queue: queue.slice(index),
      queueStart: 0,
      serverQueueStart: 0,
      offset: index,
      timeline: { tracks: [], complete: false },
      controller: new AbortController(),
      pending: false,
      retries: 0,
      autoplay,
    };
    return source;
  }
  get source() {
    return this.session?.source;
  }
  get error() {
    return this.session?.timeline.error;
  }
  get notice() {
    return this.session?.timeline.notice;
  }
  active(source: string | undefined) {
    return !!source && this.session?.source === source;
  }
  requiresRestart(queue: Track[], autoplay: boolean) {
    const session = this.session;
    return (
      !!session?.timeline.complete &&
      ((!session.autoplay && autoplay) ||
        queue.length - session.offset > session.queue.length)
    );
  }
  target(index: number): ContinuousTrack | undefined {
    const session = this.session;
    if (
      session &&
      index - session.offset + session.queueStart < session.serverQueueStart
    )
      return;
    return session?.timeline.tracks.find(
      (track) => track.index - session.queueStart + session.offset === index,
    );
  }
  canResume(index: number) {
    return !this.session?.timeline.tracks.length || !!this.target(index);
  }
  at(time: number) {
    const session = this.session;
    const part = session?.timeline.tracks.findLast(
      (track) => time >= track.start - 0.001,
    );
    if (!session || !part) return;
    return {
      index: part.index - session.queueStart + session.offset,
      position: Math.max(0, Math.min(time - part.start, part.duration)),
      duration: part.duration,
    };
  }
  appended(queue: Track[]) {
    const session = this.session;
    if (
      !session ||
      queue
        .slice(session.offset)
        .some(
          (track, index) => track.audioUrl !== session.queue[index]?.audioUrl,
        )
    )
      return [];
    return session.queue.slice(Math.max(0, queue.length - session.offset));
  }
  /** Drop completed history from the UI without replacing the native source. */
  takePrune() {
    const session = this.session;
    if (!session || !session.queueStart || !session.offset) return 0;
    const count = session.offset;
    session.offset = 0;
    return count;
  }
  private accept(
    session: NonNullable<ContinuousPlayback['session']>,
    timeline: ContinuousTimeline,
  ) {
    const queueStart = timeline.queueStart ?? 0;
    // A slower POST or poll must not restore an expired native window.
    if (
      queueStart < session.serverQueueStart ||
      (timeline.revision ?? 0) < (session.timeline.revision ?? 0)
    )
      return;
    session.serverQueueStart = queueStart;
    const first = timeline.tracks[0];
    const deferPrune =
      queueStart > session.queueStart &&
      !!first &&
      this.getTime() < first.start - 0.001;
    // Native preloading, a pause or a manual backward seek can leave the
    // audible clock in a retired segment. Preserve its UI identity until a
    // later snapshot confirms that the native clock is in the new window.
    const retainedTimeline: ContinuousTimeline = deferPrune
      ? {
          ...timeline,
          queueStart: session.queueStart,
          tracks: [
            ...session.timeline.tracks.filter(
              (track) => track.index < queueStart,
            ),
            ...timeline.tracks,
          ],
          additions: [
            ...(session.timeline.additions ?? []).filter(
              (addition) => addition.index < queueStart,
            ),
            ...(timeline.additions ?? []),
          ],
        }
      : timeline;
    const removed = deferPrune ? 0 : queueStart - session.queueStart;
    session.queue = session.queue.slice(removed);
    session.queueStart += removed;
    session.offset += removed;
    for (const addition of retainedTimeline.additions ?? [])
      if (addition.index - session.queueStart === session.queue.length)
        session.queue.push(addition.track);
    session.timeline = retainedTimeline;
    this.changed();
  }
  syncQueue(queue: Track[], autoplay: boolean) {
    const session = this.session;
    if (!session) return;
    const next = queue.slice(session.offset);
    // Published audio must never be silently mapped to a newly shuffled queue.
    if (
      session.queue.some(
        (track, index) => next[index]?.audioUrl !== track.audioUrl,
      )
    )
      return;
    if (
      (next.length > session.queue.length || autoplay !== session.autoplay) &&
      next.every((track) =>
        /^\/api\/audio\/[A-Za-z0-9_-]{11}$/.test(track.audioUrl),
      )
    ) {
      session.queue = next;
      session.autoplay = autoplay;
      void this.submit();
    }
  }
  /** Called only AFTER synchronous audio.play() in the gesture path. */
  async submit() {
    const session = this.session;
    if (!session || session.pending) return;
    clearTimeout(session.retry);
    session.pending = true;
    const ids = session.queue.map((track) =>
      track.audioUrl.slice('/api/audio/'.length),
    );
    const autoplay = session.autoplay;
    const queueStart = session.queueStart;
    try {
      const timeline = await accountRequest<ContinuousTimeline>(
        `/api/me/continuous/${session.id}`,
        {
          ids,
          autoplay,
          maxTracks: PLAYBACK_QUEUE_LIMIT,
          queueStart,
          deviceId: playbackDeviceId(),
        },
        'POST',
        session.controller.signal,
      );
      if (this.session !== session) return;
      session.retries = 0;
      this.accept(session, timeline);
      if (this.session === session) this.poll(session);
    } catch {
      if (!session.controller.signal.aborted) {
        this.log('continuous:plan-error');
        session.retry = setTimeout(
          () => void this.submit(),
          Math.min(30000, 1000 * 2 ** Math.min(session.retries++, 5)),
        );
      }
    } finally {
      session.pending = false;
      if (
        this.session === session &&
        (autoplay !== session.autoplay ||
          queueStart !== session.queueStart ||
          session.queue
            .map((track) => track.audioUrl.slice('/api/audio/'.length))
            .join(',') !== ids.join(','))
      )
        void this.submit();
    }
  }
  private poll(session: NonNullable<ContinuousPlayback['session']>) {
    clearTimeout(session.timer);
    session.timer = setTimeout(
      () => {
        void accountRequest<ContinuousTimeline>(
          `/api/me/continuous/${session.id}`,
          undefined,
          'GET',
          session.controller.signal,
        )
          .then((timeline) => {
            if (this.session !== session) return;
            this.accept(session, timeline);
            if (timeline.error) this.log('continuous:server-error');
          })
          .catch(() => {
            if (!session.controller.signal.aborted)
              this.log('continuous:timeline-error');
          })
          .finally(() => {
            if (this.session === session && !session.controller.signal.aborted)
              this.poll(session);
          });
      },
      session.timeline.tracks.length ? 3000 : 300,
    );
  }
  validQueue(queue: Track[]) {
    const session = this.session;
    return (
      !!session &&
      session.queue.every(
        (track, index) =>
          queue[index + session.offset]?.audioUrl === track.audioUrl,
      )
    );
  }
  clear() {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    session.controller.abort();
    clearTimeout(session.timer);
    clearTimeout(session.retry);
    void accountRequest(
      `/api/me/continuous/${session.id}`,
      undefined,
      'DELETE',
    ).catch(() => {});
  }
}
