import { get } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { format } from 'prettier';
const base = process.env.YOUTUBE_PLAYBACK_HTTPS_URL ?? 'https://127.0.0.1:4463';
const ca = await readFile('artifacts/https/root-ca.pem');
const checks = [];
for (const path of [
  '/__youtube/health',
  '/__youtube/',
  '/__youtube/manifest.webmanifest',
  '/__youtube/icon.png',
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
if (checks.some((c) => c.status !== 200 || !c.authorized))
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/__youtube/`);
  await expect(
    page.getByRole('heading', { name: 'YouTube Playback Lab', exact: true }),
  ).toBeVisible();
  await page.locator('#video-id').fill('m5fixture01'); // deliberately NOT an authorized or real stream
  await page.getByRole('button', { name: 'Seleziona ID', exact: true }).click();
  await page.locator('#resolve').click();
  await expect(page.locator('#resolution')).toContainText(
    /DISABLED|NO_AUTHORIZED_SOURCE/,
  );
  await expect(page.locator('#play')).toBeDisabled();
  const evidence = await page.evaluate(async () => ({
    secureContext: isSecureContext,
    serviceWorkerRegistered:
      !!(await navigator.serviceWorker.getRegistration()),
    mobileLayout: document.documentElement.scrollWidth <= innerWidth,
    audioCount: document.querySelectorAll('audio').length,
    iframeCount: document.querySelectorAll('iframe').length,
    diagnostic: JSON.parse(document.querySelector('#diagnostic').textContent),
  }));
  expect(evidence.secureContext).toBe(true);
  expect(evidence.mobileLayout).toBe(true);
  expect(evidence.serviceWorkerRegistered).toBe(false);
  expect(evidence.audioCount).toBe(1);
  expect(evidence.iframeCount).toBe(0);
  await page.screenshot({
    path: 'artifacts/youtube-playback-lab-m5.png',
    fullPage: true,
  });
  await writeFile(
    'docs/performance/m5-https-smoke.json',
    await format(
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          base,
          checks,
          ...evidence,
          limitation:
            'Desktop Chromium. Node validates CA/SAN. Browser SPKI exception only in this process. No stream or physical iPhone/background/CarPlay success claimed.',
        },
        null,
        2,
      ),
      { parser: 'json' },
    ),
  );
  console.log(
    'PASS: HTTPS CA/SAN, mobile layout, manifest, one audio, default source blocked, no SW/automatic iframe',
  );
} finally {
  await browser.close();
}
