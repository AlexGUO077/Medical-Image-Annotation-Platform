import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  evaluateDependencyPolicy,
  formatLicenseSummary,
} from './check-dependency-policy.mjs';

function makeLock(packages) {
  return { lockfileVersion: 3, packages };
}

test('records sorted allowed identifiers and entries without lockfile license metadata', () => {
  const result = evaluateDependencyPolicy(makeLock({
    '': { name: 'root' },
    'node_modules/a': { license: 'MIT' },
    'node_modules/b': { license: 'Apache-2.0' },
    'node_modules/c': {},
    'node_modules/d': { license: 'MIT' },
  }));

  assert.deepEqual(result.allowedLicenses, ['Apache-2.0', 'MIT']);
  assert.deepEqual(result.deniedLicenses, []);
  assert.deepEqual(result.entriesWithoutLicense, ['node_modules/c']);
  assert.match(formatLicenseSummary(result), /- Apache-2\.0\n- MIT/);
  assert.match(formatLicenseSummary(result), /Entries without license metadata: 1/);
});

test('blocks every denied identifier even inside a compound expression or array', () => {
  const result = evaluateDependencyPolicy(makeLock({
    'node_modules/a': { license: '(MIT OR GPL-3.0)' },
    'node_modules/b': { license: ['BSD-3-Clause', 'AGPL-3.0'] },
    'node_modules/c': { license: 'GPL-2.0' },
    'node_modules/d': { license: 'AGPL-1.0' },
  }));

  assert.deepEqual(result.allowedLicenses, ['BSD-3-Clause', 'MIT']);
  assert.deepEqual(result.deniedLicenses, ['AGPL-1.0', 'AGPL-3.0', 'GPL-2.0', 'GPL-3.0']);
});

test('fails closed for a malformed lockfile', () => {
  assert.throws(
    () => evaluateDependencyPolicy({ lockfileVersion: 3 }),
    /DEPENDENCY_POLICY_INVALID_LOCKFILE/,
  );
});

test('CLI writes allowed-license evidence and exits nonzero for denied identifiers', () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'miap-dependency-policy-'));
  try {
    const allowedLock = path.join(fixtureDir, 'allowed-lock.json');
    const deniedLock = path.join(fixtureDir, 'denied-lock.json');
    const summary = path.join(fixtureDir, 'summary.md');
    writeFileSync(allowedLock, JSON.stringify(makeLock({
      'node_modules/a': { license: 'MIT' },
      'node_modules/b': { license: 'Apache-2.0' },
    })));
    writeFileSync(deniedLock, JSON.stringify(makeLock({
      'node_modules/a': { license: 'GPL-3.0' },
    })));

    const allowed = spawnSync(process.execPath, [
      path.resolve('scripts/check-dependency-policy.mjs'),
      allowedLock,
    ], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(allowed.stdout, /Dependency license policy passed/);
    assert.match(readFileSync(summary, 'utf8'), /- Apache-2\.0\n- MIT/);

    const denied = spawnSync(process.execPath, [
      path.resolve('scripts/check-dependency-policy.mjs'),
      deniedLock,
    ], { encoding: 'utf8' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /DENIED_LICENSE_IDENTIFIERS: GPL-3\.0/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
