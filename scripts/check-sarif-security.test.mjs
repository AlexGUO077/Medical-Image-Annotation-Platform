import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { countBlockingSarifResults } from './check-sarif-security.mjs';

function withSarifDirectory(files, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'miap-sarif-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(directory, relativePath);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, JSON.stringify(content));
    }
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function sarif(runs) {
  return { version: '2.1.0', runs };
}

function run(ruleId, severity, results = [{ ruleId }]) {
  return {
    tool: { driver: { rules: [{ id: ruleId, properties: { 'security-severity': severity } }] } },
    results,
  };
}

test('clean SARIF directory exits 0', () => withSarifDirectory({
  'clean.sarif': sarif([run('js/clean', '6.9')]),
}, (directory) => {
  const result = spawnSync(process.execPath, ['scripts/check-sarif-security.mjs', directory]);
  assert.equal(result.status, 0);
}));

test('a high result in a later nested SARIF file exits nonzero', () => withSarifDirectory({
  'first.sarif': sarif([run('js/clean', '6.9')]),
  'nested/later.json': sarif([run('js/high', '7.0')]),
}, (directory) => {
  const result = spawnSync(process.execPath, ['scripts/check-sarif-security.mjs', directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /SARIF_SECURITY_THRESHOLD/);
}));

test('aggregates matching results across multiple runs and extensions', () => withSarifDirectory({
  'multi.sarif': sarif([
    run('js/first', '7.1'),
    {
      tool: {
        driver: { rules: [] },
        extensions: [{ name: 'extension', rules: [{ id: 'js/extension', properties: { 'security-severity': '8.0' } }] }],
      },
      results: [
        { rule: { id: 'js/extension', index: 0, toolComponent: { name: 'extension' } } },
        { rule: { index: 0, toolComponent: { name: 'extension' } } },
        { rule: { index: 0, toolComponent: { index: 0 } } },
      ],
    },
  ]),
}, (directory) => {
  assert.equal(countBlockingSarifResults(directory), 4);
}));

test('ignores malformed security-severity values', () => withSarifDirectory({
  'malformed.sarif': sarif([run('js/malformed', '7banana')]),
}, (directory) => {
  assert.equal(countBlockingSarifResults(directory), 0);
}));

test('fails closed for missing and empty SARIF directories', () => {
  assert.throws(() => countBlockingSarifResults('/definitely/missing/miap-sarif'));
  withSarifDirectory({}, (directory) => {
    assert.throws(() => countBlockingSarifResults(directory));
  });
});

test('fails closed for a malformed results structure', () => withSarifDirectory({
  'string-results.sarif': sarif([{ tool: { driver: { rules: [] } }, results: 'not-an-array' }]),
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_MALFORMED' });
}));

test('fails closed for a run with results but no driver', () => withSarifDirectory({
  'missing-driver.sarif': sarif([{ tool: {}, results: [{ ruleId: 'js/rule' }] }]),
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_MALFORMED' });
}));

test('fails closed when JSON files do not contain valid SARIF documents', () => withSarifDirectory({
  'not-sarif.json': { status: 'not-a-sarif-document' },
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_MALFORMED' });
}));

test('resolves a GUID-referenced extension rule instead of the driver rule', () => withSarifDirectory({
  'guid-extension.sarif': sarif([{
    tool: {
      driver: { rules: [{ id: 'js/shared', properties: { 'security-severity': '1.0' } }] },
      extensions: [{ guid: 'extension-guid', rules: [{ id: 'js/shared', properties: { 'security-severity': '9.0' } }] }],
    },
    results: [{ rule: { id: 'js/shared', toolComponent: { guid: 'extension-guid' } } }],
  }]),
}, (directory) => {
  assert.equal(countBlockingSarifResults(directory), 1);
}));

test('fails closed for an unresolved explicit tool-component GUID', () => withSarifDirectory({
  'unknown-guid.sarif': sarif([{
    tool: { driver: { rules: [{ id: 'js/shared', properties: { 'security-severity': '1.0' } }] } },
    results: [{ rule: { id: 'js/shared', toolComponent: { guid: 'missing-guid' } } }],
  }]),
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_UNSUPPORTED_REFERENCE' });
}));

test('fails closed for an out-of-range driver rule index', () => withSarifDirectory({
  'driver-index.sarif': sarif([{
    tool: { driver: { rules: [{ id: 'js/only', properties: { 'security-severity': '1.0' } }] } },
    results: [{ ruleIndex: 1 }],
  }]),
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_UNSUPPORTED_REFERENCE' });
}));

test('fails closed for an out-of-range GUID-referenced extension rule index', () => withSarifDirectory({
  'extension-index.sarif': sarif([{
    tool: {
      driver: { rules: [{ id: 'js/driver', properties: { 'security-severity': '1.0' } }] },
      extensions: [{ guid: 'extension-guid', rules: [{ id: 'js/only', properties: { 'security-severity': '9.0' } }] }],
    },
    results: [{ rule: { index: 1, toolComponent: { guid: 'extension-guid' } } }],
  }]),
}, (directory) => {
  assert.throws(() => countBlockingSarifResults(directory), { code: 'SARIF_INPUT_UNSUPPORTED_REFERENCE' });
}));
