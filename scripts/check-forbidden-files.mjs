import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SYNTHETIC_FIXTURE_ROOTS = [
  'test/fixtures/synthetic/',
  'server/test/fixtures/synthetic/',
];

const CREDENTIAL_EXTENSIONS = /\.(?:key|pem|p12|pfx|token|jks|keystore|pkcs12|ppk|p8|der|csr|secret)$/i;
const CREDENTIAL_DIRECTORY = /(?:^|\/)\.credentials(?:\/|$)/i;
const PRIVATE_INVENTORY = /(?:^|\/)(?:teaching-set|teaching-cases)\.json$/i;
const MEDICAL_IMAGE_EXTENSIONS = /(?:\.(?:dcm|dicom|ima|nii|nii\.gz)|(?:^|\/)DICOMDIR)$/i;
const DATA_PACKAGES = /\.(?:zip|rar|7z|tar|tgz|tar\.(?:gz|xz|zst)|xlsx?|csv|tsv)$/i;
const BACKUP_EXTENSIONS = /\.(?:dump|bak|backup|sql\.gz)$/i;
const RUNTIME_STORAGE_ROOTS = /^(?:data|uploads|storage|orthanc|minio|backups|exports|reports|local-demo)(?:\/|$)/i;

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
    if (PRIVATE_INVENTORY.test(path)) return [{ path, reason: 'private-teaching-inventory' }];
    if (CREDENTIAL_EXTENSIONS.test(path)) return [{ path, reason: 'credential-file' }];
    if (BACKUP_EXTENSIONS.test(path)) return [{ path, reason: 'backup-or-dump' }];
    if (RUNTIME_STORAGE_ROOTS.test(path)) return [{ path, reason: 'runtime-storage' }];
    if (MEDICAL_IMAGE_EXTENSIONS.test(path) && !isSyntheticFixture(path)) {
      return [{ path, reason: 'medical-image' }];
    }
    if (DATA_PACKAGES.test(path) && !isSyntheticFixture(path)) return [{ path, reason: 'data-package' }];

    return [];
  });
}

export function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
}

function checkPaths(paths) {
  const forbidden = findForbidden(paths);
  if (forbidden.length) {
    const reasons = [...new Set(forbidden.map(item => item.reason))].join(', ');
    throw new Error(`Rejected ${forbidden.length} private file paths (${reasons}). Review the changes locally.`);
  }
}

function commit(ref) {
  return git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
}

function checkHistory(base, tip) {
  const end = commit(tip);
  const range = base ? commit(base) + '..' + end : end;
  const revisions = git(['rev-list', range]).trim().split('\n').filter(Boolean);
  for (const revision of revisions) {
    checkPaths(git(['ls-tree', '-rz', '--name-only', revision]).split('\0').filter(Boolean));
  }
  if (!revisions.length) return;
  const scan = spawnSync('gitleaks', ['git', '--redact', '--no-banner', '--log-opts=--diff-merges=first-parent ' + range, '.'],
    {stdio: 'ignore'});
  if (scan.error?.code === 'ENOENT') throw new Error('Install Gitleaks to check outgoing commits.');
  if (scan.status !== 0) throw new Error('Gitleaks did not pass. Inspect the redacted scan locally before pushing.');
}

function main(args) {
  if (!args.length) return checkPaths(listTrackedFiles());
  if (args.length === 2 && args[0] === '--range') {
    const pair = args[1].split('..');
    if (pair.length === 2 && pair.every(ref => ref && !ref.startsWith('.'))) return checkHistory(...pair);
    throw new Error('Expected base..tip');
  }
  if (args.length !== 2 || args[0] !== '--pre-push') throw new Error('Unexpected file-check arguments');
  for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
    const [source, local, target, old] = line.split(' ');
    if (/^0+$/.test(local)) continue;
    if ([source, target].some(ref => ref.startsWith('refs/heads/local/'))) throw new Error('Local worktree branches stay on this machine.');
    let base = old;
    if (/^0+$/.test(old)) {
      const remote = 'refs/remotes/' + args[1] + '/HEAD';
      base = spawnSync('git', ['rev-parse', '--verify', '--quiet', remote], {encoding: 'utf8'}).stdout.trim() || null;
    }
    checkHistory(base, local);
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(error.status === undefined ? error.message : 'Git revision check failed. Fetch the remote baseline and retry.');
    process.exitCode = 1;
  }
}
