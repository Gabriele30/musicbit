import type { Page } from '@playwright/test';

export async function openPlayer(page: Page) {
  if (
    await page
      .getByRole('button', { name: 'Chiudi player', exact: true })
      .isVisible()
  )
    return;
  await page.locator('.mini-title').click();
}

export async function openQueue(page: Page) {
  await openPlayer(page);
  await page.getByRole('button', { name: 'Coda', exact: true }).click();
}

export async function openDiagnostics(page: Page) {
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Il tuo spazio' })
    .getByRole('button', { name: 'Diagnostica', exact: true })
    .click();
}
