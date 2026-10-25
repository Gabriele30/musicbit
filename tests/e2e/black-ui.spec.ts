import { test, expect } from '@playwright/test';
import { installFixtures, libraryFixture } from './fixtures/mobile-catalog.mjs';
test.use({ serviceWorkers: 'block' });
test('black mobile surfaces, square artwork and taste feedback remain usable across phone sizes', async ({
  page,
}, info) => {
  await installFixtures(page.context());
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user: null, registrationEnabled: false } }),
  );
  await page.addInitScript(
    (library) =>
      localStorage.setItem('musicbit.library.v1', JSON.stringify(library)),
    libraryFixture(),
  );
  await page.goto('/');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#000000',
  );
  const manifest = await (
    await page.request.get('/manifest.webmanifest')
  ).json();
  expect(manifest.theme_color).toBe('#000000');
  expect(manifest.background_color).toBe('#000000');
  const quick = page.getByRole('region', {
    name: 'Le tue scelte veloci',
    exact: true,
  });
  await expect(quick.getByRole('button')).toHaveCount(6);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe('rgb(0, 0, 0)');
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            fits: document.documentElement.scrollWidth <= innerWidth,
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          })),
        { message: `Layout must settle without overflow at ${width}px` },
      )
      .toMatchObject({ fits: true })
      .catch(async (error) => {
        await info.attach(`overflow-${width}`, {
          contentType: 'application/json',
          body: JSON.stringify(
            await page.evaluate(() => ({
              viewport: innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              elements: [...document.querySelectorAll('body *')]
                .map((element) => {
                  const rect = element.getBoundingClientRect();
                  return {
                    tag: element.tagName,
                    className: element.className,
                    right: rect.right,
                    width: rect.width,
                  };
                })
                .filter((rect) => rect.right > innerWidth + 1 && rect.width > 0)
                .slice(0, 100),
            })),
          ),
        });
        throw error;
      });
    const size = await quick.locator('.cover-art').first().boundingBox();
    expect(Math.abs(size!.width - size!.height)).toBeLessThan(1);
  }
  const personal = page.locator('.personal-section');
  await expect(
    personal.getByText('Nu Genea', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Strumenti personali' })
    .getByRole('button', { name: /Taste Profile/ })
    .click();
  await page
    .getByLabel('Preferenza per Nu Genea', { exact: true })
    .selectOption('blocked');
  await page
    .getByRole('navigation', { name: 'Navigazione mobile', exact: true })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(quick.getByText('Nu Genea', { exact: true })).toHaveCount(0);
  await expect(personal.getByText('Nu Genea', { exact: true })).toHaveCount(0);
  const dismissed = await personal
    .locator('.personal-track')
    .first()
    .locator('strong')
    .innerText();
  await personal
    .getByRole('button', { name: `Meno come ${dismissed}`, exact: true })
    .click();
  await expect(personal.getByText(dismissed, { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `artifacts/${info.project.name}-black-home.png`,
    animations: 'disabled',
  });
});
