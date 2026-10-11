import { expect, test } from '@playwright/test';
const base = `http://127.0.0.1:${process.env.MUSICBIT_YOUTUBE_E2E_PORT || 4184}/__youtube/`;
test.beforeEach(async ({ page }) => {
  await page.goto(base);
});
test('M5 catalog selection cannot silently play an unauthorized source', async ({
  page,
}) => {
  await page.locator('#video-id').fill('blocked0001');
  await page.getByRole('button', { name: 'Seleziona ID', exact: true }).click();
  await page.locator('#resolve').click();
  await expect(page.locator('#resolution')).toContainText('unavailable');
  await expect(page.locator('#play')).toBeDisabled();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
  expect(await page.locator('iframe').count()).toBe(0);
});
test('M5 original fixture: search → select → resolve → native playback uses one audio', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Original TEST ONLY m5fixture01 · MusicBit fixture',
      exact: true,
    })
    .click();
  await page.locator('#resolve').click();
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.volume = 0;
    audio.dataset.persistent = 'yes';
  });
  await page.locator('#play').click();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('#native-status')).toContainText('playing');
  await page.locator('#video-id').fill('m5fixture02');
  await page.getByRole('button', { name: 'Seleziona ID', exact: true }).click();
  await page.locator('#stage').click();
  await expect(page.locator('#next')).toBeEnabled();
  expect(await page.locator('audio').getAttribute('src')).toContain(
    'm5fixture01',
  );
  await page.locator('#next').click();
  await expect(page.locator('audio')).toHaveAttribute('src', /m5fixture02/);
  await expect(page.locator('audio')).toHaveAttribute('data-persistent', 'yes');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('#diagnostic')).toContainText('"kind": "next"');
  expect(await page.locator('audio').count()).toBe(1);
  expect(await page.locator('#diagnostic').textContent()).not.toContain(
    '/test-media/',
  );
});
test('M5 original fixture: explicit preparation and cancellation', async ({
  page,
}) => {
  await page.locator('#video-id').fill('m5fixture01');
  await page.getByRole('button', { name: 'Seleziona ID', exact: true }).click();
  await page.locator('#resolve').click();
  await expect(page.locator('#prepare')).toBeEnabled();
  await page.locator('#prepare').click();
  await expect(page.locator('#native-status')).toContainText('ready');
  await page.locator('#play').click();
  await expect(page.locator('#native-status')).toContainText('playing');
  await expect(page.locator('#diagnostic')).toContainText('"kind": "prepared"');
  await page.locator('#pause').click();
  await expect(page.locator('#native-status')).toContainText('paused');
});
test('M5 layout, secure manifest and independent routes', async ({
  page,
  request,
}) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const manifest = await request.get(`${base}manifest.webmanifest`);
  expect((await manifest.json()).scope).toBe('/__youtube/');
  expect(
    (await request.get('http://127.0.0.1:3001/__youtube/health')).status(),
  ).toBe(404);
});
test('M5 test transport: HTTP media failure is visible and no fallback is attempted', async ({
  page,
  request,
  browserName,
}) => {
  const id = browserName === 'webkit' ? 'm5fixture04' : 'm5fixture03';
  const observations = () =>
    request.get(`${base}test-observations`).then((r) => r.json());
  const before = (await observations())[`${id}.wav`];
  await page.locator('#video-id').fill(id);
  await page.getByRole('button', { name: 'Seleziona ID', exact: true }).click();
  await page.locator('#resolve').click();
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#play').click();
  await expect(page.locator('#native-status')).toContainText('MEDIA_');
  await expect(page.locator('#diagnostic')).toContainText('"error": "MEDIA_');
  // Windows WebKit's native media requests bypass Playwright page request events.
  await expect
    .poll(async () => (await observations())[`${id}.wav`])
    .toBeGreaterThan(before);
  const diagnostic = JSON.parse(
    (await page.locator('#diagnostic').textContent())!,
  );
  expect(diagnostic.native.attempts).toHaveLength(1);
  expect(diagnostic.native.attempts[0].trackId).toBe(id);
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
});
