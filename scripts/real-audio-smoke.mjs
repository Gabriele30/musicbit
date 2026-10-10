import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Optional live-network integration check, intentionally separate from CI/E2E.
const base = process.env.MUSICBIT_BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  await page.goto(base);
  await expect(
    page.getByRole('button', {
      name: 'Riproduci SoundHelix Song 1',
      exact: true,
    }),
  ).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/desktop-player.png',
    fullPage: true,
  });
  await page.locator('audio').evaluate((audio) => {
    audio.volume = 0;
  });
  const results = [];
  for (const number of [1, 2, 3]) {
    await page
      .getByRole('button', {
        name: `Riproduci SoundHelix Song ${number}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
    ).toBeVisible({ timeout: 30000 });
    await expect
      .poll(
        () => page.locator('audio').evaluate((audio) => audio.currentTime),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0.1);
    const media = await page.locator('audio').evaluate((audio) => ({
      src: audio.currentSrc,
      duration: audio.duration,
      position: audio.currentTime,
      readyState: audio.readyState,
      error: audio.error?.message ?? null,
    }));
    expect(media.src).toContain(`SoundHelix-Song-${number}.mp3`);
    expect(media.duration).toBeGreaterThan(60);
    expect(media.error).toBeNull();
    results.push({ track: number, ...media });
    console.log(
      `PASS: real MP3 ${number}, playing + position advancing, duration ${media.duration.toFixed(1)}s`,
    );
  }
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navigazione principale' })
    .getByRole('button', { name: 'Diagnostica' })
    .click();
  await page.screenshot({
    path: 'artifacts/desktop-diagnostics.png',
    fullPage: true,
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta JSON' }).click();
  const download = await downloadEvent;
  await download.saveAs('artifacts/real-audio-diagnostics.json');
  await writeFile(
    'artifacts/real-audio-results.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        browser: browser.version(),
        results,
        limitation:
          'Desktop Chromium only; no proof of iOS/CarPlay behavior or physical audio output.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
