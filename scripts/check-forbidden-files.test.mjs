import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findForbidden } from './check-forbidden-files.mjs';

test('rejects medical files, credentials, and real environment files', () => {
  assert.equal(findForbidden(['sample.dcm', '.env', 'backup.dump']).length, 3);
});

test('allows an explicitly reviewed synthetic fixture path', () => {
  assert.deepEqual(findForbidden(['server/test/fixtures/synthetic/readme.md']), []);
});

test('allows medical synthetic fixtures only in reviewed fixture roots', () => {
  assert.deepEqual(findForbidden(['test/fixtures/synthetic/example.dcm']), []);
  assert.deepEqual(findForbidden(['server/test/fixtures/synthetic/example.nii.gz']), []);
});

test('does not allow credentials or environment files in synthetic fixture roots', () => {
  assert.equal(findForbidden(['test/fixtures/synthetic/.env']).length, 1);
  assert.equal(findForbidden(['server/test/fixtures/synthetic/signing.key']).length, 1);
});

test('rejects credential directories outside synthetic fixture roots', () => {
  assert.equal(findForbidden(['.credentials/service-account.json']).length, 1);
});

test('rejects credential directories inside synthetic fixture roots', () => {
  assert.equal(findForbidden(['test/fixtures/synthetic/.credentials/auth.json']).length, 1);
});

test('rejects runtime data directories and backup formats', () => {
  assert.equal(findForbidden(['uploads/case-1/image.png']).length, 1);
  assert.equal(findForbidden(['exports/case-1.zip']).length, 1);
  assert.equal(findForbidden(['database.backup']).length, 1);
});

test('checks an outgoing commit even when the data file was removed before the tip', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'miap-publish-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {cwd, stdio:'pipe'});
  git('init', '--quiet');
  git('commit', '--quiet', '--allow-empty', '-m', 'baseline');
  const base = git('rev-parse','HEAD').toString().trim();
  writeFileSync(join(cwd,'private-list.xlsx'), 'synthetic test placeholder');
  git('add', 'private-list.xlsx');
  git('commit', '--quiet','-m','intermediate');
  git('rm','private-list.xlsx');
  git('commit','--quiet','-m','remove');
  const script = fileURLToPath(new URL('./check-forbidden-files.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--range', base + '..HEAD'], {cwd, encoding:'utf8'});
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /data-package/);
  assert.doesNotMatch(checked.stderr, /private-list/);
});
