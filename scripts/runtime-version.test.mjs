import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupportedRuntime } from './runtime-version.mjs';

test('accepts the approved Node 24 patch version', () => {
  assert.doesNotThrow(() => assertSupportedRuntime('v24.14.0'));
});

test('rejects a different Node major or patch version', () => {
  assert.throws(() => assertSupportedRuntime('v24.13.0'), /Node 24\.14\.0 is required/);
  assert.throws(() => assertSupportedRuntime('v20.20.2'), /Node 24\.14\.0 is required/);
});
