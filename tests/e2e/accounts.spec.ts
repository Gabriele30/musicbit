import { test, expect, type Page } from '@playwright/test';
import { emptyLibrary } from '../../packages/shared/dist/index.js';
test.use({ serviceWorkers: 'block' });

test('account profile, backup, second-device sync and conflicts preserve one audio element', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const username = `listener_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await page.goto('/?screen=profile');
  const audio = await page.locator('audio').elementHandle();
  await page
    .getByRole('button', { name: 'Crea un account', exact: true })
    .click();
  await page.getByLabel('Nome utente', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Crea account', exact: true }).click();
  await expect(page.getByLabel(`Profilo di ${username}`)).toBeVisible();
  await page.getByLabel(`Profilo di ${username}`).click();
  await expect(
    page.getByRole('heading', { name: username, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Libreria sincronizzata.', { exact: true }),
  ).toBeVisible();
  expect(
    await audio!.evaluate((el) => el === document.querySelector('audio')),
  ).toBe(true);
  const library = emptyLibrary();
  library.playlists = [
    { id: 'personal-mix', name: 'Personal mix', tracks: [], updatedAt: 1 },
  ];
  await page.getByLabel('Importa backup', { exact: false }).setInputFiles({
    name: 'library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ library })),
  });
  await page.getByRole('button', { name: 'Conferma importazione' }).click();
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/me/library');
      return (await r.json()).library.playlists[0]?.name;
    })
    .toBe('Personal mix');
  await page
    .getByLabel('Nome del profilo', { exact: true })
    .fill('Listener profile');
  await page
    .getByRole('button', { name: 'Salva profilo', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Listener profile', exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Esporta backup', exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/^musicbit-/);
  const other = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  try {
    const second = await other.newPage();
    await second.goto(`${baseURL}/?screen=profile`);
    await login(second, username);
    await expect(
      second.getByRole('heading', { name: 'Listener profile', exact: true }),
    ).toBeVisible();
    await expect(
      second.getByText('Libreria sincronizzata.', { exact: true }),
    ).toBeVisible();
    const before = await (
      await second.request.get(`${baseURL}/api/me/library`)
    ).json();
    expect(before.library.playlists[0].name).toBe('Personal mix');
    before.library.playlists[0].name = 'Changed on second device';
    const update = await second.request.put(`${baseURL}/api/me/library`, {
      headers: { 'x-musicbit-request': '1' },
      data: { revision: before.revision, library: before.library },
    });
    expect(update.ok()).toBe(true);
    await page.getByLabel('Varietà dei suggerimenti').selectOption('discovery');
    await expect(
      page.getByRole('button', { name: 'Usa versione server', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Usa versione server', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Usa versione server', exact: true })
      .click();
    await expect(
      page.getByText('Libreria sincronizzata.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/${info.project.name}-profile.png`,
      fullPage: true,
    });
    expect(await page.locator('audio').count()).toBe(1);
    await page
      .getByRole('button', { name: 'Esci dall’account', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Bentornato', exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get('/api/auth/session')).json()).user,
    ).toBeNull();
    expect(await page.locator('audio').count()).toBe(1);
  } finally {
    await other.close();
  }
});

async function login(page: Page, username: string) {
  await page.getByLabel('Nome utente', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  const profile = page.getByRole('button', { name: /^Profilo di / });
  await expect(profile).toBeVisible();
  await profile.click();
}
