import { get } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createHash, X509Certificate } from 'node:crypto';

const base = process.env.MUSICBIT_HTTPS_URL ?? 'https://127.0.0.1:4443';
const ca = await readFile('artifacts/https/root-ca.pem');
const results = [];
for (const path of [
  '/health',
  '/api/tracks',
  '/manifest.webmanifest',
  '/sw.js',
  '/?screen=diagnostics',
]) {
  const result = await new Promise((resolve, reject) => {
    get(`${base}${path}`, { ca, timeout: 10000 }, (response) => {
      const authorized = response.socket.authorized;
      const protocol = response.socket.getProtocol();
      response.resume();
      response.on('end', () =>
        resolve({ path, status: response.statusCode, authorized, protocol }),
      );
    })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy(new Error('HTTPS timeout'));
      });
  });
  if (result.status !== 200 || !result.authorized)
    throw new Error(JSON.stringify(result));
  results.push(result);
}
const cert = new X509Certificate(await readFile('artifacts/https/server.pem'));
const spki = createHash('sha256')
  .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
const browser = await chromium.launch({
  args: [`--ignore-certificate-errors-spki-list=${spki}`],
});
try {
  // CA validation above is real. Browser override is confined to this test context;
  // it does NOT establish trust on an iPhone or install a CA in the OS.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/?screen=diagnostics`);
  await expect(
    page.getByRole('heading', { name: 'Diagnostica', exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SW timeout')), 10000),
      ),
    ]);
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await expect(
    page
      .locator('.diagnostic-controls')
      .getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: 'artifacts/https-diagnostics-m2.png',
    fullPage: true,
  });
  const secureContext = await page.evaluate(() => isSecureContext);
  await writeFile(
    'docs/performance/https-smoke.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        results,
        secureContext,
        serviceWorkerControlled: true,
        limitation:
          'Desktop only, explicit CA for Node TLS checks; browser trusts only the test certificate SPKI in this test process. iPhone trust, firewall reachability from phone, PWA install and CarPlay untested.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `PASS HTTPS: CA/SAN verification, endpoints, secure context, SW; ${base}`,
  );
} finally {
  await browser.close();
}
