import { chromium, expect, devices } from '@playwright/test';
import { get } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Explicit live integration check; no mocks, not part of CI, never YouTube audio.
const base = process.env.MUSICBIT_BASE_URL || 'http://127.0.0.1:4173';
const args = [];
let tlsVerified = false;
if (base.startsWith('https:')) {
  // For the existing LAN test certificate only; validate chain + SAN with Node.
  const ca = await readFile('artifacts/https/root-ca.pem');
  await new Promise((resolve, reject) => {
    get(`${base}/health`, { ca, timeout: 10_000 }, (response) => {
      response.resume();
      response.on('end', () =>
        response.statusCode === 200 && response.socket.authorized
          ? resolve()
          : reject(new Error('HTTPS health failed')),
      );
    })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('TLS timeout'));
      });
  });
  tlsVerified = true;
  const cert = new X509Certificate(
    await readFile('artifacts/https/server.pem'),
  );
  const spki = createHash('sha256')
    .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  args.push(`--ignore-certificate-errors-spki-list=${spki}`);
}
const browser = await chromium.launch({ args });
try {
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await page.goto(base);
  await expect(page.locator('.version-tag')).toHaveText('M3');
  await page.locator('audio').evaluate((audio) => {
    audio.volume = 0;
    audio.dataset.instance = 'live-m3';
  });
  await page
    .getByRole('button', { name: 'Riproduci SoundHelix Song 1', exact: true })
    .click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio) => audio.currentTime), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0.1);
  const before = await page.locator('audio').evaluate((audio) => ({
    src: audio.currentSrc,
    position: audio.currentTime,
  }));
  await page
    .getByRole('navigation', { name: 'Navigazione mobile' })
    .getByRole('button', { name: 'Cerca', exact: true })
    .click();
  const searchResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/search',
  );
  await page.getByLabel('Cerca nel catalogo').fill('Johann Sebastian Bach');
  const response = await searchResponse;
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.items.length).toBeGreaterThan(0);
  const panel = page.getByRole('region', { name: 'Catalogo musicale' });
  await panel.locator('.catalog-result').first().click();
  await expect(panel.locator('.catalog-facts')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    panel.getByRole('button', { name: /play|riproduci/i }),
  ).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.locator('audio')).toHaveAttribute(
    'data-instance',
    'live-m3',
  );
  const after = await page.locator('audio').evaluate((audio) => ({
    src: audio.currentSrc,
    position: audio.currentTime,
    paused: audio.paused,
    error: audio.error?.code ?? null,
  }));
  expect(after.src).toBe(before.src);
  expect(after.position).toBeGreaterThan(before.position);
  expect(after.paused).toBe(false);
  expect(after.error).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const secureContext = await page.evaluate(() => isSecureContext);
  const serviceWorkerRegistered = await page.evaluate(
    async () => !!(await navigator.serviceWorker.getRegistration()),
  );
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/catalog-live-m3.png',
    fullPage: true,
  });
  await writeFile(
    process.env.CATALOG_SMOKE_OUTPUT ||
      'docs/performance/catalog-live-smoke.json',
    `${JSON.stringify({ testedAt: new Date().toISOString(), base, browser: browser.version(), tlsVerified, secureContext, serviceWorkerRegistered, results: data.items.length, searchTiming: data.timing, singleAudioPreserved: true, demoPositionBefore: before.position, demoPositionAfter: after.position, playerError: after.error, limitation: 'Chromium desktop with mobile viewport; physical output muted. TLS browser override limited to this certificate SPKI, Node verifies CA/SAN. No OS/iPhone trust installation, physical iPhone test or CarPlay validation.' }, null, 2)}\n`,
  );
  console.log(
    'PASS: live catalog, details, single demo audio continuity, mobile layout',
  );
} finally {
  await browser.close();
}
