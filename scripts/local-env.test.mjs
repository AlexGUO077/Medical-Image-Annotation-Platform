import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLocalEnv } from './create-local-env.mjs';

const script = fileURLToPath(new URL('./create-local-env.mjs', import.meta.url));

test('generates every required local key without patient data fields', () => {
  const env = createLocalEnv(() => 'fixed-random-value');

  assert.match(env, /^POSTGRES_PASSWORD=fixed-random-value$/m);
  assert.match(env, /^ORTHANC_USERNAME=fixed-random-value$/m);
  assert.match(env, /^MINIO_ROOT_PASSWORD=fixed-random-value$/m);
  assert.match(env, /^REDIS_PASSWORD=fixed-random-value$/m);
  assert.match(env, /^ELASTIC_PASSWORD=fixed-random-value$/m);
  assert.match(env, /^POSTGRES_HOST=127\.0\.0\.1$/m);
  assert.match(env, /^ELASTICSEARCH_PORT=9200$/m);
  assert.doesNotMatch(env, /PATIENT|DICOM_FILE|REPORT_TEXT/);
});

test('writes only .env.local and never reveals generated credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'miap-local-env-'));
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const environment = readFileSync(join(directory, '.env.local'), 'utf8');
  assert.match(environment, /^POSTGRES_PASSWORD=.+$/m);
  assert.match(environment, /^MINIO_ROOT_PASSWORD=.+$/m);
  assert.doesNotMatch(result.stdout, /POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD/);
  assert.doesNotMatch(result.stderr, /POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD/);
});

test('refuses to overwrite an existing .env.local unless explicitly forced', () => {
  const directory = mkdtempSync(join(tmpdir(), 'miap-local-env-'));
  const envPath = join(directory, '.env.local');
  writeFileSync(envPath, 'POSTGRES_PASSWORD=preserve-this-value\n');

  const rejected = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Refusing to overwrite .env.local; use --force/);
  assert.equal(readFileSync(envPath, 'utf8'), 'POSTGRES_PASSWORD=preserve-this-value\n');

  const forced = execFileSync(process.execPath, [script, '--force'], {
    cwd: directory,
    encoding: 'utf8'
  });
  assert.match(forced, /Created .env.local/);
  assert.doesNotMatch(forced, /POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD/);
  assert.match(readFileSync(envPath, 'utf8'), /^POSTGRES_PASSWORD=.+$/m);
});
