import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { parseSpotifyChart, registerSpotifyCharts } from './charts.js';

const fixture = (date = '2026/10/12') =>
  `<body><h1>Spotify Daily Chart - Italy - ${date}</h1><table><tbody>${Array.from({ length: 20 }, (_, i) => `<tr><td>${i + 1}</td><td>+1</td><td><a href="../artist/abc.html">Artist &amp; Guest</a> - <a href="../track/${String(i).padStart(22, '0')}.html">Song &#039;${i + 1}&#039;</a></td><td>1</td><td>1</td><td></td><td>12,345</td></tr>`).join('')}</tbody></table></body>`;
describe('dated public Spotify charts', () => {
  it('parses real positions and source dates, decodes entities and marks old data', () => {
    const now = Date.parse('2026-10-13T00:00:00Z');
    const chart = parseSpotifyChart(fixture(), 'it', now);
    expect(chart).toMatchObject({
      market: 'it',
      date: '2026-10-12',
      stale: false,
      sourceUrl: 'https://kworb.net/spotify/country/it_daily.html',
    });
    expect(chart.entries).toHaveLength(20);
    expect(chart.entries[0]).toMatchObject({
      position: 1,
      title: "Song '1'",
      artist: 'Artist & Guest',
      streams: 12345,
      spotifyUrl: 'https://open.spotify.com/track/0000000000000000000000',
    });
    expect(parseSpotifyChart(fixture('2026/10/01'), 'it', now).stale).toBe(
      true,
    );
    expect(() => parseSpotifyChart(fixture('2030/10/12'), 'it', now)).toThrow();
    expect(() =>
      parseSpotifyChart(
        fixture().replace('<td>2</td>', '<td>7</td>'),
        'it',
        now,
      ),
    ).toThrow();
    expect(() =>
      parseSpotifyChart('<h1>Login required</h1>', 'it', now),
    ).toThrow();
  });
  it('caches regional charts and only permits the two fixed upstream URLs', async () => {
    const app = Fastify();
    const request = vi.fn(
      async () =>
        new Response(
          fixture(new Date().toISOString().slice(0, 10).replaceAll('-', '/')),
        ),
    );
    registerSpotifyCharts(app, request);
    try {
      expect(
        (await app.inject('/api/charts/spotify?market=it')).statusCode,
      ).toBe(200);
      expect(
        (await app.inject('/api/charts/spotify?market=it')).json().entries,
      ).toHaveLength(20);
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]?.[0]).toBe(
        'https://kworb.net/spotify/country/it_daily.html',
      );
      expect(
        (await app.inject('/api/charts/spotify?market=https://example.com'))
          .statusCode,
      ).toBe(400);
      expect(request).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});
