import type {
  ContinuousTimeline,
  Track,
  ContinuousTrack,
} from '@musicbit/shared';
import { accountRequest } from '../account';

/** Controls a single native HLS source, with track-relative UI positions. */
export class ContinuousPlayback {
  private session?: {
    id: string;
    source: string;
    queue: Track[];
    offset: number;
    timeline: ContinuousTimeline;
    controller: AbortController;
    timer?: ReturnType<typeof setTimeout>;
    pending: boolean;
    autoplay: boolean;
  };
  enabled = false;
  constructor(
    private changed: () => void,
    private log: (event: string) => void,
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
      offset: index,
      timeline: { tracks: [], complete: false },
      controller: new AbortController(),
      pending: false,
      autoplay,
    };
    return source;
  }
  get source() {
    return this.session?.source;
  }
  active(source: string | undefined) {
    return !!source && this.session?.source === source;
  }
  target(index: number): ContinuousTrack | undefined {
    const session = this.session;
    return session?.timeline.tracks.find(
      (track) => track.index + session.offset === index,
    );
  }
  at(time: number) {
    const session = this.session;
    const part = session?.timeline.tracks.findLast(
      (track) => time >= track.start - 0.001,
    );
    if (!session || !part) return;
    return {
      index: part.index + session.offset,
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
    return session.queue.slice(queue.length - session.offset);
  }
  private accept(
    session: NonNullable<ContinuousPlayback['session']>,
    timeline: ContinuousTimeline,
  ) {
    for (const addition of timeline.additions ?? [])
      if (addition.index === session.queue.length)
        session.queue.push(addition.track);
    session.timeline = timeline;
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
    session.pending = true;
    const ids = session.queue.map((track) =>
      track.audioUrl.slice('/api/audio/'.length),
    );
    const autoplay = session.autoplay;
    try {
      const timeline = await accountRequest<ContinuousTimeline>(
        `/api/me/continuous/${session.id}`,
        { ids, autoplay, maxTracks: 500 - session.offset },
        'POST',
        session.controller.signal,
      );
      if (this.session !== session) return;
      this.accept(session, timeline);
      this.poll(session);
    } catch {
      if (!session.controller.signal.aborted) this.log('continuous:plan-error');
    } finally {
      session.pending = false;
      if (
        this.session === session &&
        (autoplay !== session.autoplay ||
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
    void accountRequest(
      `/api/me/continuous/${session.id}`,
      undefined,
      'DELETE',
    ).catch(() => {});
  }
}
