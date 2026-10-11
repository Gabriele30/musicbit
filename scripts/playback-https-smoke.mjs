import { get } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const base = process.env.PLAYBACK_HTTPS_URL ?? 'https://127.0.0.1:4453';
const ca = await readFile('artifacts/https/root-ca.pem');
const checks = [];
for (const path of [
  '/__playback/health',
  '/__playback/',
  '/__playback/manifest.webmanifest',
  '/__playback/icon.png',
]) {
  checks.push(
    await new Promise((resolve, reject) => {
      get(`${base}${path}`, { ca, timeout: 10000 }, (response) => {
        const authorized = response.socket.authorized;
        response.resume();
        response.on('end', () =>
          resolve({ path, status: response.statusCode, authorized }),
        );
      })
        .on('error', reject)
        .on('timeout', function () {
          this.destroy(new Error('HTTPS_TIMEOUT'));
        });
    }),
  );
}
if (checks.some((check) => check.status !== 200 || !check.authorized))
  throw new Error('TLS/HTTP validation failed');
const certificate = new X509Certificate(
  await readFile('artifacts/https/server.pem'),
);
const spki = createHash('sha256')
  .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
const browser = await chromium.launch({
  args: [`--ignore-certificate-errors-spki-list=${spki}`],
});
try {
  // Browser trust exception is limited to this certificate. No OS/iPhone trust changes.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/__playback/`);
  await expect(
    page.getByRole('heading', { name: 'Playback Lab', exact: true }),
  ).toBeVisible();
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
  await page.getByRole('button', { name: 'Prepara audio' }).click();
  await expect(page.locator('#play-status')).toHaveText('ready', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Riproduci', exact: true }).click();
  await expect(page.locator('#play-status')).toHaveText('playing');
  const evidence = await page.evaluate(async () => ({
    secureContext: isSecureContext,
    serviceWorkerRegistered:
      !!(await navigator.serviceWorker.getRegistration()),
    mobileLayout: document.documentElement.scrollWidth <= innerWidth,
    audioCount: document.querySelectorAll('audio').length,
    diagnostic: JSON.parse(document.querySelector('#diagnostic').textContent),
  }));
  expect(evidence.secureContext).toBe(true);
  expect(evidence.mobileLayout).toBe(true);
  expect(evidence.serviceWorkerRegistered).toBe(false);
  expect(evidence.audioCount).toBe(1);
  await page.screenshot({
    path: 'artifacts/playback-lab-m4.png',
    fullPage: true,
  });
  await writeFile(
    'docs/performance/m4-https-smoke.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        checks,
        ...evidence,
        limitation:
          'Desktop Chromium, muted output. Node validates CA and SAN; browser SPKI exception confined to this process. No physical iPhone, trust installation or CarPlay test.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: HTTPS CA/SAN, mobile layout, manifest, authorized remote preparation/playback, one audio, no lab service worker',
  );
} finally {
  await browser.close();
}
