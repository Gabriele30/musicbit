import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackTelemetry } from './telemetry';

const instances: PlaybackTelemetry[] = [];
afterEach(() => instances.splice(0).forEach((t) => t.setEnabled(false)));

function setup(status = 200) {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response('{}', { status }),
  );
  const telemetry = new PlaybackTelemetry('/api/me/diagnostics', fetcher);
  instances.push(telemetry);
  return { telemetry, fetcher };
}

describe('playback telemetry', () => {
  it('records nothing for guests', async () => {
    const { telemetry, fetcher } = setup();
    telemetry.record({ ev: 'playing' });
    await telemetry.flush();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uploads with the same-origin account marker the API requires', async () => {
    // Without X-MusicBit-Request the API answers 403 and every record is lost.
    const { telemetry, fetcher } = setup();
    telemetry.setEnabled(true);
    telemetry.record({ ev: 'ended', pos: 1.23456, track: 'abcdefghijk' });
    await telemetry.flush();
    const init = fetcher.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-MusicBit-Request': '1' });
    const body = JSON.parse(String(init.body)) as {
      records: Record<string, unknown>[];
    };
    expect(body.records[0]).toMatchObject({
      ev: 'ended',
      pos: 1.235,
      track: 'abcdefghijk',
    });
  });
  it('keeps a bounded backlog when the server is unavailable', async () => {
    const { telemetry, fetcher } = setup(503);
    telemetry.setEnabled(true);
    for (let i = 0; i < 600; i++) telemetry.record({ ev: 'tick', i });
    await telemetry.flush();
    await telemetry.flush();
    const sizes = fetcher.mock.calls.map(
      ([, init]) =>
        (JSON.parse(String(init!.body)) as { records: unknown[] }).records
          .length,
    );
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
  });
});
