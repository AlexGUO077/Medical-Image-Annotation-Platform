import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupportedRuntime } from './runtime-version.mjs';

test('accepts the approved Node 20 patch version', () => {
  assert.doesNotThrow(() => assertSupportedRuntime('v20.20.2'));
});

test('rejects a different Node major or patch version', () => {
  assert.throws(() => assertSupportedRuntime('v24.14.0'), /Node 20\.20\.2 is required/);
  assert.throws(() => assertSupportedRuntime('v20.19.0'), /Node 20\.20\.2 is required/);
});
