import { expect, test } from '@playwright/test';

test.use({
  baseURL: `http://127.0.0.1:${process.env.MUSICBIT_PLAYBACK_E2E_PORT || 4182}`,
  serviceWorkers: 'block',
});
const searchAndSelect = async (page: import('@playwright/test').Page) => {
  await page.goto('/__playback/');
  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'SoundHelix Song 1 · T. Schürger',
      exact: true,
    })
    .click();
  await expect(page.locator('#resolution')).toContainText('Disponibile');
  await page.locator('audio').evaluate((audio) => {
    audio.volume = 0;
  });
};
test('lab searches, resolves, prepares and plays through one persistent audio', async ({
  page,
}) => {
  await searchAndSelect(page);
  await page.locator('audio').evaluate((audio) => {
    audio.dataset.identity = 'persistent';
  });
  await page
    .getByRole('button', { name: 'Prepara audio', exact: true })
    .click();
  await expect(page.locator('#play-status')).toHaveText('ready');
  expect(await page.locator('audio').evaluate((audio) => audio.paused)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toHaveText('playing');
  await expect(page.locator('#diagnostic')).toContainText('"kind": "prepared"');
  await page
    .getByRole('button', { name: 'Risolvi prossima demo', exact: true })
    .click();
  await expect(page.locator('#next-status')).toContainText(
    'Descrittore pronto',
  );
  expect(await page.locator('audio').getAttribute('src')).toContain(
    'soundhelix-1',
  );
  await page
    .getByRole('button', { name: 'Riproduci prossima', exact: true })
    .click();
  await expect(page.locator('#play-status')).toHaveText('playing');
  expect(await page.locator('audio').getAttribute('src')).toContain(
    'soundhelix-2',
  );
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-identity',
    'persistent',
  );
});
test('lab selection during playback preserves current source and hot resolution is measured', async ({
  page,
}) => {
  await searchAndSelect(page);
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toHaveText('playing');
  await page
    .getByRole('button', {
      name: 'SoundHelix Song 2 · T. Schürger',
      exact: true,
    })
    .click();
  await expect(page.locator('#selected')).toContainText('Song 2');
  await expect(page.locator('#resolution')).toContainText('Disponibile');
  expect(await page.locator('audio').getAttribute('src')).toContain(
    'soundhelix-1',
  );
  expect(await page.locator('audio').evaluate((audio) => audio.paused)).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Risolvi di nuovo' }).click();
  await expect(page.locator('#diagnostic')).toContainText('"cache": "hit"');
});
test('lab treats YouTube as catalog-only and exposes no play action for unavailable sources', async ({
  page,
}) => {
  await page.route('**/__playback/api/search?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            reference: { catalogProvider: 'youtube', catalogId: 'abc' },
            title: 'Metadata only',
            artist: 'Example',
            sourceUrl: 'https://music.youtube.com/watch?v=abc',
          },
        ],
      },
    }),
  );
  await page.goto('/__playback/');
  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  await page.getByRole('button', { name: 'Metadata only · Example' }).click();
  await expect(page.locator('#resolution')).toContainText(
    'NO_AUTHORIZED_SOURCE',
  );
  await expect(
    page.getByRole('button', { name: 'Riproduci', exact: true }),
  ).toBeDisabled();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
});
test('lab cancels preparation and automatically advances only to a staged authorized source', async ({
  page,
}) => {
  await searchAndSelect(page);
  await page
    .getByRole('button', { name: 'Prepara audio', exact: true })
    .click();
  await expect(page.locator('#play-status')).toHaveText('ready');
  await page.getByRole('button', { name: 'Annulla preparazione' }).click();
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toHaveText('playing');
  await page
    .getByRole('button', { name: 'Risolvi prossima demo', exact: true })
    .click();
  await expect(page.locator('#next-status')).toContainText(
    'Descrittore pronto',
  );
  // Native ended event (seek near end), not a synthetic dispatch.
  await page.locator('audio').evaluate((audio) => {
    audio.currentTime = audio.duration - 0.1;
  });
  await expect
    .poll(() => page.locator('audio').getAttribute('src'))
    .toContain('soundhelix-2');
  await expect(page.locator('#play-status')).toHaveText('playing');
  await expect(page.locator('#diagnostic')).toContainText('"kind": "ended"');
});
test('lab records a real HTTP media failure and recovers after resolving again', async ({
  page,
}) => {
  await page.route('**/__playback/api/resolve', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.resolution.source.url = '/__playback/test-media/missing.wav';
    await route.fulfill({ json: data });
  });
  await searchAndSelect(page);
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toContainText('error');
  await expect(page.locator('#diagnostic')).toContainText('MEDIA_');
  await page.unroute('**/__playback/api/resolve');
  await page.getByRole('button', { name: 'Risolvi di nuovo' }).click();
  await expect(page.locator('#resolution')).toContainText('Disponibile');
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toHaveText('playing');
});
