import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, devices } from '@playwright/test';

// Optional live provider check, separate from the deterministic test suite.
// Uses isolated browser storage; never changes the user's library.
const base = process.env.MUSICBIT_SMOKE_URL || 'http://127.0.0.1:4705';
const artist = process.env.MUSICBIT_SMOKE_ARTIST || 'Daft Punk';
const results = [];
await mkdir('artifacts', { recursive: true });
for (const [name, launcher] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await launcher.launch();
  let page;
  try {
    const device = { ...devices['iPhone 13'] };
    delete device.defaultBrowserType;
    const context = await browser.newContext({
      ...device,
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    const errors = [];
    const demoRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/tracks')
        demoRequests.push(request.url());
    });
    const feedResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/feed') && response.ok(),
    );
    await page.goto(base);
    const feed = await (await feedResponse).json();
    assert(feed.sections.length > 0, 'Live home feed is empty');
    await page
      .getByRole('heading', { name: feed.sections[0].title, exact: true })
      .waitFor();
    assert.equal(await page.locator('audio').getAttribute('src'), null);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.music-card-art img')]
          .slice(0, 5)
          .every((img) => img.complete),
      undefined,
      { timeout: 10000 },
    );
    const firstCard = await page
      .locator('.music-card-main')
      .first()
      .boundingBox();
    assert(
      firstCard && firstCard.y < 350,
      'Music is too low on the initial mobile screen',
    );
    assert.equal(
      demoRequests.length,
      0,
      'Normal sessions must not fetch demo tracks',
    );
    await page.screenshot({ path: `artifacts/${name}-live-home.png` });
    const nav = page.getByRole('navigation', { name: 'Navigazione mobile' });
    await nav.getByRole('button', { name: 'Cerca', exact: true }).click();
    await page.getByLabel('Cerca nel catalogo').fill(artist);
    await page.getByRole('button', { name: 'Artisti', exact: true }).click();
    const detailResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/catalog/youtube/artist/') &&
        response.ok(),
    );
    await page
      .getByRole('button', { name: `Dettagli ${artist}`, exact: true })
      .first()
      .click();
    const detail = (await (await detailResponse).json()).item;
    assert(
      detail.tracks.length > 0 && detail.albums.length > 0,
      'Artist is missing songs or discography',
    );
    await page
      .getByRole('button', { name: 'Segui artista', exact: true })
      .click();
    await page.locator('audio').evaluate((audio) => {
      audio.dataset.instance = 'live-music';
      audio.volume = 0;
      const events = [];
      for (const name of [
        'loadedmetadata',
        'durationchange',
        'playing',
        'ended',
        'error',
      ])
        audio.addEventListener(name, () => {
          events.push({
            event: name,
            src: audio.getAttribute('src'),
            time: audio.currentTime,
            duration: audio.duration,
            ended: audio.ended,
            error: audio.error?.code,
          });
          audio.dataset.liveEvents = JSON.stringify(events.slice(-50));
        });
    });
    await page
      .getByRole('button', { name: 'Riproduci artista', exact: true })
      .click();
    await page.waitForFunction(
      () => {
        const audio = document.querySelector('audio');
        return (
          audio && ((!audio.paused && audio.currentTime > 0.3) || audio.error)
        );
      },
      undefined,
      { timeout: 30000 },
    );
    await page.screenshot({ path: `artifacts/${name}-live-artist.png` });
    await page.locator('.mini-title').click();
    const repeatControl = await page
      .getByRole('button', { name: /^Ripetizione:/ })
      .boundingBox();
    assert(
      repeatControl &&
        repeatControl.y + repeatControl.height <= page.viewportSize().height,
      'Player controls require scrolling on the mobile screen',
    );
    const queueControl = await page
      .getByRole('button', { name: 'Coda', exact: true })
      .boundingBox();
    assert(
      queueControl && queueControl.y < 100,
      'Queue is not immediately reachable from the player',
    );
    await page.screenshot({ path: `artifacts/${name}-live-player.png` });
    await page.getByRole('button', { name: 'Coda', exact: true }).click();
    await page.locator('.suggested-track').first().waitFor({ timeout: 15000 });
    const suggestions = await page.locator('.suggested-track').count();
    const snapshot = await page.locator('audio').evaluate((audio) => ({
      source: new URL(audio.currentSrc).pathname,
      duration: audio.duration,
      position: audio.currentTime,
      preserved: audio.dataset.instance === 'live-music',
    }));
    assert(snapshot.preserved && snapshot.position > 0.3);
    assert.equal(await page.locator('audio').count(), 1);
    await nav.getByRole('button', { name: 'Home', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Ascoltati di recente', exact: true })
      .waitFor();
    await page
      .getByRole('heading', { name: 'Gli artisti che segui', exact: true })
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `artifacts/${name}-live-desktop.png` });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator('audio').evaluate((audio) => audio.pause());
    results.push({
      browser: name,
      feedSections: feed.sections.map((section) => ({
        title: section.title,
        count: section.items.length,
      })),
      artist: detail.title,
      songs: detail.tracks.length,
      albums: detail.albums.length,
      relatedArtists: detail.relatedArtists?.length ?? 0,
      suggestions,
      audio: snapshot,
      pageErrors: errors,
      firstMusicCard: firstCard,
      demoRequests: demoRequests.length,
      playerControlsVisible: true,
    });
  } catch (error) {
    const media = await page?.locator('audio').evaluate((audio) => ({
      src: audio.getAttribute('src'),
      duration: audio.duration,
      time: audio.currentTime,
      paused: audio.paused,
      ended: audio.ended,
      readyState: audio.readyState,
      error: audio.error?.code,
      events: JSON.parse(audio.dataset.liveEvents || '[]'),
    }));
    await page?.screenshot({ path: `artifacts/${name}-live-failure.png` });
    results.push({ browser: name, failure: error.message, media });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  base,
  note: 'Desktop browsers with mobile viewport; no physical iPhone or lock-screen claim. Single live sample, not a performance benchmark.',
  results,
};
await writeFile(
  'artifacts/music-experience-smoke.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
