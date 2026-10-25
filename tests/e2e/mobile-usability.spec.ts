import { test, expect, type Page, type Cookie } from '@playwright/test';
import { installFixtures, libraryFixture } from './fixtures/mobile-catalog.mjs';

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
let cookies: Cookie[];
// Share an isolated account within this scenario group; do not exhaust the real
// authentication throttle by creating a new account for each viewport check.
test.beforeAll(async ({ request }) => {
  const headers = { 'x-musicbit-request': '1' };
  const registered = await request.post('/api/auth/register', {
    headers,
    data: {
      username: `mobile_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      password: 'mobile-test-password',
    },
  });
  expect(registered.ok()).toBe(true);
  const envelope = await (await request.get('/api/me/library')).json();
  const saved = await request.put('/api/me/library', {
    headers,
    data: { revision: envelope.revision, library: libraryFixture() },
  });
  expect(saved.ok()).toBe(true);
  cookies = (await request.storageState()).cookies;
});
async function prepare(page: Page) {
  await page.context().addCookies(cookies);
  await installFixtures(page.context());
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Scelte veloci', exact: true }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Navigazione mobile', exact: true })
    .getByRole('button', { name, exact: true })
    .click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test('a delayed account response cannot discard an early search', async ({
  page,
}) => {
  await page.context().addCookies(cookies);
  await installFixtures(page.context());
  let release = () => {};
  const accountReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/session', async (route) => {
    await accountReady;
    await route.continue();
  });
  try {
    await page.goto('/?screen=search');
    await expect(page.getByRole('status')).toHaveText(
      'Apriamo il tuo spazio musicale…',
    );
    await expect(page.getByLabel('Cerca nel catalogo')).toHaveCount(0);
  } finally {
    release();
  }
  const input = page.getByLabel('Cerca nel catalogo', { exact: true });
  await input.fill('Toni');
  await expect(
    page.getByRole('region', { name: 'Risultato principale' }),
  ).toBeVisible();
  await expect(input).toHaveValue('Toni');
  await expect(page.locator('audio')).toHaveCount(1);
});

test('personal home exposes quick picks and opens the actual taste controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await prepare(page);
  const picks = page.getByRole('region', {
    name: 'Le tue scelte veloci',
    exact: true,
  });
  await expect(picks.getByRole('button').first()).toBeInViewport();
  const shortcuts = page.getByRole('region', { name: 'Strumenti personali' });
  const dimensions = await shortcuts.evaluate((element) => ({
    width: element.clientWidth,
    first: element.querySelector('button')!.getBoundingClientRect().width,
  }));
  expect(dimensions.first).toBeLessThan(dimensions.width - 10);
  await shortcuts.getByRole('button', { name: /Taste Profile/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Taste Profile', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Taste Profile', exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
});

test('playlist covers remain square and queue actions leave readable titles on small phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepare(page);
  await nav(page, 'Libreria');
  await page
    .getByRole('group', { name: 'Sezioni della libreria' })
    .getByRole('button', { name: 'Playlist', exact: true })
    .click();
  const covers = page.locator('.playlist-shortcuts:visible .playlist-cover');
  await expect(covers).toHaveCount(2);
  const sizes = await covers.evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect(),
        parent = item.parentElement!.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        right: rect.right,
        parentRight: parent.right,
      };
    }),
  );
  expect(Math.abs(sizes[0]!.width - sizes[1]!.width)).toBeLessThan(1);
  for (const size of sizes) {
    expect(Math.abs(size.width - size.height)).toBeLessThan(1);
    expect(size.right).toBeLessThanOrEqual(size.parentRight);
  }
  await page.getByRole('button', { name: /La sera, senza fretta/ }).click();
  await page.getByRole('button', { name: /^Riproduci DISISA$/ }).click();
  await page.locator('.mini-title').click();
  await page.getByRole('button', { name: 'Coda', exact: true }).click();
  await expect(
    page.locator('.playback-queue .queue-list li').nth(1),
  ).toBeInViewport();
  expect(
    (await page.locator('.playback-queue .track-copy').nth(1).boundingBox())!
      .width,
  ).toBeGreaterThan(120);
  const count = await page.locator('.playback-queue .queue-list li').count();
  await page.getByRole('button', { name: /Opzioni posizione 2:/ }).click();
  await page
    .getByRole('button', { name: 'Rimuovi posizione 2', exact: true })
    .click();
  await expect(page.locator('.playback-queue .queue-list li')).toHaveCount(
    count - 1,
  );
  await noOverflow(page);
  await page
    .getByRole('button', { name: /^Riproduci posizione \d+: Montescuderi/ })
    .click();
  await expect(page.locator('.playback-queue .current-track')).toContainText(
    'Montescuderi',
  );
  await expect(page.locator('.playback-queue .current-track')).toBeInViewport();
  await expect(
    page.locator('.playback-queue .current-track + li'),
  ).toBeInViewport();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('.mini-title').click();
  await expect(
    page.getByRole('button', { name: 'Traccia successiva', exact: true }),
  ).toBeInViewport();
  await expect(page.locator('.transport .play-button')).toBeInViewport();
  await noOverflow(page);
});

test('touch search retains settled suggestions and offers an explicit results action', async ({
  page,
}) => {
  await prepare(page);
  await nav(page, 'Cerca');
  const input = page.getByLabel('Cerca nel catalogo', { exact: true });
  await input.fill('Toni');
  await expect(
    page.getByRole('region', { name: 'Risultato principale' }),
  ).toBeVisible();
  await expect(
    page.getByRole('listbox', { name: 'Suggerimenti di ricerca' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 450 });
  await expect(
    page.getByRole('button', { name: 'Mostra tutti i risultati' }),
  ).toBeInViewport();
  await page.getByRole('button', { name: 'Mostra tutti i risultati' }).click();
  await expect(
    page.getByRole('listbox', { name: 'Suggerimenti di ricerca' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Risultato principale' }),
  ).toBeVisible();
  await noOverflow(page);
});
