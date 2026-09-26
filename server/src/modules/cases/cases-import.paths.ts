import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const IMPORT_QUARANTINE_ROOT = resolve(
  process.env.IMPORT_QUARANTINE_DIR ?? resolve(tmpdir(), 'miap-import-quarantine'),
);

export const MANUAL_QUARANTINE_ROOT = join(IMPORT_QUARANTINE_ROOT, 'manual');
