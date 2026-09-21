import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const IMPORT_QUARANTINE_ROOT = resolve(
  process.env.IMPORT_QUARANTINE_DIR ?? resolve(tmpdir(), 'miap-import-quarantine'),
);
