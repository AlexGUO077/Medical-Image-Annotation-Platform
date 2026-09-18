import assert from 'node:assert/strict';
import test from 'node:test';
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

test('rejects runtime data directories and backup formats', () => {
  assert.equal(findForbidden(['uploads/case-1/image.png']).length, 1);
  assert.equal(findForbidden(['exports/case-1.zip']).length, 1);
  assert.equal(findForbidden(['database.backup']).length, 1);
});
