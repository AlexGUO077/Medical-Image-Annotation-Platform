import { execFileSync } from 'node:child_process';

const SYNTHETIC_FIXTURE_ROOTS = [
  'test/fixtures/synthetic/',
  'server/test/fixtures/synthetic/',
];

const CREDENTIAL_EXTENSIONS = /\.(?:key|pem|p12|pfx|token|jks|keystore|pkcs12|ppk|p8|der|csr|secret)$/i;
const CREDENTIAL_DIRECTORY = /(?:^|\/)\.credentials(?:\/|$)/i;
const MEDICAL_IMAGE_EXTENSIONS = /\.(?:dcm|dicom|nii|nii\.gz)$/i;
const BACKUP_EXTENSIONS = /\.(?:dump|bak|backup|sql\.gz)$/i;
const RUNTIME_STORAGE_ROOTS = /^(?:data|uploads|storage|orthanc|minio|backups|exports)(?:\/|$)/i;

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isSyntheticFixture(path) {
  return SYNTHETIC_FIXTURE_ROOTS.some((root) => path.startsWith(root));
}

function isRealEnvironmentFile(path) {
  return /(?:^|\/)\.env(?:\..+)?$/i.test(path) && path !== '.env.example';
}

export function findForbidden(files) {
  return files.flatMap((file) => {
    const path = normalizePath(file);

    if (isRealEnvironmentFile(path)) return [{ path, reason: 'environment-file' }];
    if (CREDENTIAL_DIRECTORY.test(path)) return [{ path, reason: 'credential-directory' }];
    if (CREDENTIAL_EXTENSIONS.test(path)) return [{ path, reason: 'credential-file' }];
    if (BACKUP_EXTENSIONS.test(path)) return [{ path, reason: 'backup-or-dump' }];
    if (RUNTIME_STORAGE_ROOTS.test(path)) return [{ path, reason: 'runtime-storage' }];
    if (MEDICAL_IMAGE_EXTENSIONS.test(path) && !isSyntheticFixture(path)) {
      return [{ path, reason: 'medical-image' }];
    }

    return [];
  });
}

export function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function main() {
  const forbidden = findForbidden(listTrackedFiles());
  if (forbidden.length === 0) return;

  console.error('Forbidden tracked file(s):');
  for (const { path, reason } of forbidden) console.error(`- ${path} (${reason})`);
  process.exitCode = 1;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) main();
