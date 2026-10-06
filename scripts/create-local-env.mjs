import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const localDefaults = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'miap',
  POSTGRES_DB: 'miap_synthetic',
  CORS_ORIGINS: 'http://localhost:5173',
  ORTHANC_HOST: '127.0.0.1',
  ORTHANC_PORT: '8042',
  MINIO_HOST: '127.0.0.1',
  MINIO_PORT: '9000',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  ELASTICSEARCH_HOST: '127.0.0.1',
  ELASTICSEARCH_PORT: '9200',
  SEARCH_ELASTIC_USERNAME: 'miap_search',
  SEARCH_ELASTIC_INDEX: 'miap-published-v1'
};

const secretKeys = [
  'POSTGRES_PASSWORD',
  'SEED_ADMIN_PASSWORD',
  'JWT_SECRET',
  'MFA_ENCRYPTION_KEY',
  'ORTHANC_USERNAME',
  'ORTHANC_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'REDIS_PASSWORD',
  'ELASTIC_PASSWORD',
  'SEARCH_ELASTIC_PASSWORD'
];

function createRandomSecret() {
  return randomBytes(32).toString('base64url');
}

export function createLocalEnv(randomSecret = createRandomSecret) {
  const environment = { ...localDefaults };

  for (const key of secretKeys) {
    environment[key] = randomSecret();
  }

  return `${Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

export function writeLocalEnv({ cwd = process.cwd(), force = false } = {}) {
  const target = resolve(cwd, '.env.local');

  try {
    writeFileSync(target, createLocalEnv(), { encoding: 'utf8', flag: force ? 'w' : 'wx', mode: 0o600 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Refusing to overwrite .env.local; use --force');
    }
    throw error;
  }
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    writeLocalEnv({ force: process.argv.slice(2).includes('--force') });
    process.stdout.write('Created .env.local with local synthetic-development credentials.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to create .env.local'}\n`);
    process.exitCode = 1;
  }
}
