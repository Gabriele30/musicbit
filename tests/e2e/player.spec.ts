import { test, expect, type Page } from '@playwright/test';

// Test server supplies local PCM WAVs to the real native media pipeline.
async function fixture(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('button', {
      name: 'Riproduci SoundHelix Song 1',
      exact: true,
    }),
  ).toBeVisible();
}

test('native audio survives screens and supports controls, seeking and queue changes', async ({
  page,
}, info) => {
  await fixture(page);
  await page.evaluate(() => {
    const audio = document.querySelector('audio')!;
    audio.dataset.instance = 'original';
    audio.volume = 0;
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.duration),
    )
    .toBe(30);
  await page.getByRole('button', { name: 'Pausa', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In pausa$/ }),
  ).toBeVisible();
  await page.getByRole('slider').fill('10');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(9.9);
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Diagnostica' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Diagnostica', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.metric').last()).not.toHaveText(/—/);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'original',
  );
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Coda' })
    .click();
  await page.getByRole('button', { name: 'Rimuovi posizione 3' }).click();
  await expect(page.locator('.queue-list li')).toHaveCount(2);
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Player', exact: true })
    .click();
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({
    path: `artifacts/${info.project.name}-player.png`,
    fullPage: true,
  });
});

test('automatically advances after the real ended event', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await page.getByRole('slider').fill('29.7');
  await expect(
    page.getByRole('heading', { name: 'SoundHelix Song 2', exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
});

test('shows a failed source and recovers by selecting another track', async ({
  page,
}) => {
  await page.route('**/api/tracks', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.tracks[0].audioUrl = '/__test_media/missing.wav';
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('button', { name: 'Traccia successiva', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: /^In riproduzione$/ }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('production PWA has install metadata and an offline shell without cached media', async ({
  page,
  context,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  const manifest = await response.json();
  expect(manifest.name).toBe('MusicBit');
  expect(manifest.display).toBe('standalone');
  expect(
    manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512'),
  ).toBe(true);
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Premi play. Prenditi spazio.',
  );
  await expect(page.getByRole('alert')).toContainText('API');
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((entry) => entry.url),
        ),
      )
    ).flat(),
  );
  expect(
    cached.some(
      (url) =>
        url.includes('soundhelix.com') ||
        url.includes('/api/tracks') ||
        url.includes('/__test_media/'),
    ),
  ).toBe(false);
  await context.setOffline(false);
});
