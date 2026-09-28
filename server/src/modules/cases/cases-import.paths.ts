import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const configuredRoot = resolve(
  process.env.IMPORT_QUARANTINE_DIR ?? resolve(tmpdir(), 'miap-import-quarantine'),
);
mkdirSync(configuredRoot, { recursive: true, mode: 0o700 });
export const IMPORT_QUARANTINE_ROOT = realpathSync(configuredRoot);
export const MANUAL_QUARANTINE_ROOT = join(IMPORT_QUARANTINE_ROOT, 'manual');

// Resolve existing parents too: drafts may name files that have not been created yet.
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('隔离路径无效');
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}

// Python and Node must agree on symlinked temporary roots (e.g. macOS /var).
export function quarantinePath(...parts: string[]): string {
  const path = canonicalPath(resolve(IMPORT_QUARANTINE_ROOT, ...parts));
  if (!path.startsWith(`${IMPORT_QUARANTINE_ROOT}/`)) throw new Error('隔离路径无效');
  return path;
}
