import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { parseProviderSession } from '../apps/api/dist/audio/provider-session.js';

// Load the actual packaged extension and its real cookies API. A web page with
// mocked chrome.cookies cannot catch a host-permission regression.
const root = resolve('artifacts/provider-recovery/native-extension-tests');
await mkdir(root, { recursive: true });
const profile = await mkdtemp(join(root, 'test-'));
const path = resolve('tools/youtube-session-extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
});
let privateContext;
try {
  let page = await context.newPage();
  await page.goto('chrome://extensions/');
  const extensions = await page.evaluate(
    () =>
      new Promise((done) =>
        globalThis.chrome.developerPrivate.getExtensionsInfo(
          { includeDisabled: true },
          done,
        ),
      ),
  );
  const extension = extensions.find(
    (item) => item.name === 'MusicBit · collega YouTube',
  );
  assert(
    extension && extension.state === 'ENABLED',
    'Extension must be loaded and enabled',
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(
    () =>
      new Promise((done) =>
        globalThis.chrome.developerPrivate.updateProfileConfiguration(
          { inDeveloperMode: true },
          done,
        ),
      ),
  );
  await page.evaluate(
    (extensionId) =>
      new Promise((done) =>
        globalThis.chrome.developerPrivate.updateExtensionConfiguration(
          { extensionId, incognitoAccess: true },
          done,
        ),
      ),
    extension.id,
  );
  await context.addCookies([
    {
      name: 'SAPISID',
      value: 'native-test-only',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    },
    {
      name: 'SID',
      value: 'native-test-sid',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    },
    {
      name: 'SID',
      value: 'foreign-test-only',
      domain: '.google.com',
      path: '/',
      secure: true,
    },
  ]);
  await expect(async () => {
    await page.goto(`chrome-extension://${extension.id}/popup.html`);
  }).toPass({ timeout: 10000 });
  await page.getByRole('button', { name: 'Esporta per il mio server' }).click();
  await expect(page.locator('#status')).toContainText('finestra in incognito');
  privateContext = await context.browser().newContext();
  await privateContext.addCookies([
    {
      name: 'SAPISID',
      value: 'private-native-test-only',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    },
    {
      name: 'SID',
      value: 'private-native-sid',
      domain: '.youtube.com',
      path: '/',
      secure: true,
    },
    {
      name: 'SID',
      value: 'foreign-test-only',
      domain: '.google.com',
      path: '/',
      secure: true,
    },
  ]);
  page = await privateContext.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${extension.id}/popup.html`);
  assert.equal(
    await page.evaluate(() => globalThis.chrome.extension.inIncognitoContext),
    true,
  );
  const pending = page.waitForEvent('download', { timeout: 5000 });
  await page
    .getByRole('button', { name: 'Esporta per il mio server', exact: true })
    .click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'youtube.cookies');
  const output = join(root, 'fake-export.cookies');
  await download.saveAs(output);
  assert.equal(
    parseProviderSession(await readFile(output, 'utf8')),
    'SAPISID=private-native-test-only; SID=private-native-sid',
  );
  await expect(page.locator('#status')).toContainText('File esportato');
  await expect(
    page.getByRole('button', { name: 'Esporta per il mio server' }),
  ).toBeEnabled();
  assert(
    (await context.cookies('https://www.youtube.com')).some(
      (c) => c.value === 'native-test-only',
    ),
  );
  await expect(page.locator('#status')).toContainText(
    'Chiudi tutte le finestre',
  );
  await privateContext.clearCookies();
  await page.reload();
  await page.getByRole('button', { name: 'Esporta per il mio server' }).click();
  await expect(page.locator('#status')).toContainText(
    'Nessuna sessione leggibile',
  );
  await expect(
    page.getByRole('button', { name: 'Esporta per il mio server' }),
  ).toBeEnabled();
  assert.deepEqual(errors, []);
  await writeFile(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        actualExtension: true,
        realCookieApi: true,
        realCredentialsUsed: false,
        signedOutHandled: true,
        regularExportBlocked: true,
        separatePrivateCookieStore: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Native extension: export, domain permissions and signed-out feedback passed with fake isolated cookies.',
  );
} finally {
  await privateContext?.close();
  await context.close();
  // Delete only the exact new test profile created within the audit directory.
  if (resolve(profile).startsWith(root + sep))
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 300,
    });
}
