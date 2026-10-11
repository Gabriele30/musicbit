import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Provenance checks only. Never loads or executes code from the audited projects.
const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8'),
);
const roots = Object.fromEntries(
  Object.entries(snapshot.repositories).map(([id, repo]) => [
    id,
    resolve(
      process.env[repo.pathEnvironment] ||
        resolve(root, '../musicbit-audits', repo.checkout),
    ),
  ]),
);
const git = (id, ...args) =>
  execFileSync('git', ['-C', roots[id], ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function source(id, relative) {
  const path = resolve(roots[id], relative);
  assert.ok(
    path.startsWith(roots[id] + sep),
    'Evidence must stay in its clone',
  );
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

test('all audited checkouts match the recorded commit SHA', () => {
  for (const [id, repo] of Object.entries(snapshot.repositories)) {
    assert.equal(git(id, 'rev-parse', 'HEAD'), repo.sha, id);
  }
});

test('the effective core HEAD is the superproject gitlink', () => {
  const tree = git('simpmusic', 'ls-tree', 'HEAD', 'core');
  assert.match(
    tree,
    new RegExp(`^160000 commit ${snapshot.repositories.core.sha}\\tcore$`),
  );
  assert.equal(
    git('core', 'rev-parse', 'HEAD'),
    snapshot.repositories.core.sha,
  );
});

test('extractor and QuickJS versions match the Gradle pins being audited', () => {
  const catalog = source('simpmusic', 'gradle/libs.versions.toml');
  assert.match(catalog, /pipepipe = "f8982ca9e7"/);
  assert.match(catalog, /brave-newpipe = "0fcaf19ecc"/);
  assert.match(catalog, /quickjs = "1\.0\.15"/);
  assert.ok(snapshot.repositories.pipepipe.sha.startsWith('f8982ca9e7'));
  assert.ok(snapshot.repositories.bravepipe.sha.startsWith('0fcaf19ecc'));
  assert.equal(
    git('quickjs', 'rev-parse', 'v1.0.15^{commit}'),
    snapshot.repositories.quickjs.sha,
  );
});

test('all recorded evidence matches the normalized source SHA-256', () => {
  for (const entry of snapshot.evidence) {
    const hash = createHash('sha256')
      .update(source(entry.repository, entry.path))
      .digest('hex');
    assert.equal(hash, entry.sha256, `${entry.repository}:${entry.path}`);
  }
});

test('the license files match GPL v3 and Apache 2.0 provenance', () => {
  for (const id of ['simpmusic', 'core', 'pipepipe', 'bravepipe']) {
    assert.match(source(id, 'LICENSE'), /GNU GENERAL PUBLIC LICENSE/);
    assert.match(source(id, 'LICENSE'), /Version 3, 29 June 2007/);
  }
  assert.match(source('quickjs', 'LICENSE.txt'), /Apache License/);
  assert.match(source('quickjs', 'LICENSE.txt'), /Version 2\.0/);
});

test('report code citations use exact commits, recorded files and valid lines', () => {
  const report = readFileSync(
    resolve(root, 'docs/simpmusic-backend-integration.md'),
    'utf8',
  );
  const definitions = new Map(
    [...report.matchAll(/^\[([^\]]+)\]: (https:\/\/\S+)$/gm)].map(
      ([, id, url]) => [id, url],
    ),
  );
  for (const [, id] of report.matchAll(/\[([SCBPQ]-[a-z-]+)\]/g)) {
    assert.ok(definitions.has(id), `Missing citation ${id}`);
  }
  assert.equal(definitions.size, snapshot.references.length);
  for (const ref of snapshot.references) {
    const repo = snapshot.repositories[ref.repository];
    const url = `https://github.com/${repo.slug}/blob/${repo.sha}/${ref.path}#L${ref.first}-L${ref.last}`;
    assert.equal(definitions.get(ref.id), url, ref.id);
    const text = source(ref.repository, ref.path);
    const count = text.trimEnd().split('\n').length;
    assert.ok(
      ref.first >= 1 && ref.last >= ref.first && ref.last <= count,
      ref.id,
    );
    assert.ok(
      snapshot.evidence.some(
        (entry) =>
          entry.repository === ref.repository && entry.path === ref.path,
      ),
      `Unrecorded evidence ${ref.id}`,
    );
  }
});

test('all audited clones remain clean', () => {
  for (const id of Object.keys(snapshot.repositories)) {
    assert.equal(
      git(id, 'status', '--porcelain', '--untracked-files=normal'),
      '',
      id,
    );
  }
});
