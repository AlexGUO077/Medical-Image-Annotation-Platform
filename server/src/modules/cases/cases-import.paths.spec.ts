import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { IMPORT_QUARANTINE_ROOT, quarantinePath } from './cases-import.paths';

const temporaryPaths: string[] = [];
afterEach(() => { for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('quarantine filesystem containment', () => {
  it.each(['../outside', '/etc/passwd', `${IMPORT_QUARANTINE_ROOT}-other/file`, IMPORT_QUARANTINE_ROOT])('rejects outside or root path %s', (path) => {
    expect(() => quarantinePath(path)).toThrow('隔离路径无效');
  });
  it('accepts normalized child paths only', () => {
    expect(quarantinePath('manual', 'draft', 'processed', 'key-image.png')).toBe(join(IMPORT_QUARANTINE_ROOT, 'manual/draft/processed/key-image.png'));
  });
  it('accepts both canonical worker paths and a symlink alias to the quarantine', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'wp05-path-alias-'));
    temporaryPaths.push(temporary);
    const alias = join(temporary, 'quarantine');
    symlinkSync(IMPORT_QUARANTINE_ROOT, alias, 'dir');
    const expected = join(realpathSync(IMPORT_QUARANTINE_ROOT), 'processed/mapping.json');
    expect(quarantinePath(alias, 'processed/mapping.json')).toBe(expected);
    expect(quarantinePath(expected)).toBe(expected);
  });
  it('rejects dangling symlinks before a future write can follow them outside', () => {
    const inside = mkdtempSync(join(IMPORT_QUARANTINE_ROOT, 'path-test-'));
    temporaryPaths.push(inside);
    const link = join(inside, 'dangling');
    symlinkSync(join(tmpdir(), 'outside-' + basename(inside), 'new.png'), link);
    expect(() => quarantinePath(link)).toThrow('隔离路径无效');
    expect(() => quarantinePath(link, 'child.png')).toThrow('隔离路径无效');
  });
  it('rejects a symlink inside quarantine pointing outside, including future children', () => {
    const outside = mkdtempSync(join(tmpdir(), 'wp05-path-outside-'));
    const inside = mkdtempSync(join(IMPORT_QUARANTINE_ROOT, 'path-test-'));
    temporaryPaths.push(outside, inside);
    symlinkSync(outside, join(inside, 'escape'), 'dir');
    expect(() => quarantinePath(inside, 'escape/future/file.png')).toThrow('隔离路径无效');
  });
});
