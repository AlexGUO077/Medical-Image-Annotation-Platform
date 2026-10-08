import { ForbiddenException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { WorkbenchService } from './workbench.service';
const id = '00000000-0000-4000-8000-000000000001';
const actor = { id, username: 'synthetic-member', real_name: '合成查看员', role: 'member', status: 'active', expire_at: '2099-12-31', must_change_password: false, updated_at: new Date('2026-01-01') } as AuthUser;
beforeEach(() => {
  vi.spyOn(PermissionService.prototype, 'assertCaseAssignment').mockResolvedValue();
  vi.spyOn(PermissionService.prototype, 'assertPublishedCase').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const pixels = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#999' } }).png().toBuffer();
  const h = { current: { ...actor }, missing: false, attachmentMissing: false, source: { object_key: `cases/${id}/attachment`, filename: 'safe.pdf' }, auditFailure: false };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return [h.current];
    if (sql.startsWith('SELECT id,case_no')) return h.missing ? [] : [{ id, system_code: 'resp' }];
    if (sql.startsWith('SELECT s.id')) return [{ id: 'series', frame_count: 3 }];
    if (sql.startsWith('SELECT sentences')) return [{ sentences: [{ idx: 2, text: '后句', private: 'omit' }, { idx: 0, text: '首句' }] }];
    if (sql.startsWith('SELECT object_key')) return h.attachmentMissing ? [] : [h.source];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit failed');
    void values; return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const objects = { pageCount: vi.fn().mockResolvedValue(2), readPng: vi.fn().mockResolvedValue(pixels) };
  const service = new WorkbenchService(db as never, objects as never);
  return { h, query, objects, service, pixels, attachment: (page: unknown = '2', role: 'annotate' | 'review' | 'library' = 'annotate', version?: number) => service.attachment(actor, id, id, page, 'local', role, version) };
}
describe('workbench safe metadata and attachments', () => {
  it('orders report sentences, exposes safe metadata, and rechecks assignment before output', async () => {
    const s = await setup(); const result = await s.service.read(actor, id, 'local');
    expect(result.sentences).toEqual([{ idx: 0, text: '首句' }, { idx: 2, text: '后句' }]);
    expect(result.series).toEqual([{ id: 'series', frame_count: 3 }]);
    expect(PermissionService.prototype.assertCaseAssignment).toHaveBeenCalledTimes(2);
  });
  it('watermarks PDF page pixels and returns the page count without object storage keys', async () => {
    const s = await setup(); const result = await s.attachment();
    expect(result.page_count).toBe(2);
    expect(s.objects.readPng).toHaveBeenCalledWith(`cases/${id}/attachment/page-2.png`);
    expect(await sharp(result.image).removeAlpha().raw().toBuffer()).not.toEqual(await sharp(s.pixels).removeAlpha().raw().toBuffer());
    expect(Object.keys(result).sort()).toEqual(['image', 'page_count']);
  });
  it('reads a manual key image as one page and audits library access', async () => {
    const s = await setup(); s.h.source.filename = 'key-image.png';
    expect((await s.attachment('1', 'library', 3)).page_count).toBe(1);
    expect(s.objects.pageCount).not.toHaveBeenCalled();
    expect(s.objects.readPng).toHaveBeenCalledWith(s.h.source.object_key);
    expect(s.query.mock.calls.some(c => c[0].includes('library.attachment_viewed'))).toBe(true);
  });
  it.each(['0', '-1', '1.5', '9007199254740992', 1])('rejects malformed page %s before storage access', async page => {
    const s = await setup(); await expect(s.attachment(page)).rejects.toMatchObject({ status: 400 });
    expect(s.objects.readPng).not.toHaveBeenCalled();
  });
  it('rejects out-of-range pages and cross-case/missing attachment references', async () => {
    const s = await setup(); await expect(s.attachment('3')).rejects.toMatchObject({ status: 400 });
    s.h.source.object_key = 'cases/another/attachment';
    await expect(s.attachment()).rejects.toMatchObject({ status: 404 });
    s.h.attachmentMissing = true; await expect(s.attachment()).rejects.toMatchObject({ status: 404 });
    expect(s.objects.readPng).not.toHaveBeenCalled();
  });
  it('denies stale users, unavailable cases and invalid library versions', async () => {
    const s = await setup(); s.h.current.status = 'disabled';
    await expect(s.service.read(actor, id, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.current.status = 'active'; s.h.missing = true;
    await expect(s.service.read(actor, id, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.missing = false;
    await expect(s.attachment('1', 'library')).rejects.toMatchObject({ status: 403 });
  });
  it('withholds rendered pixels when permissions expire during storage I/O or auditing fails', async () => {
    const s = await setup();
    vi.mocked(PermissionService.prototype.assertCaseAssignment).mockResolvedValueOnce().mockRejectedValueOnce(new ForbiddenException());
    await expect(s.attachment()).rejects.toMatchObject({ status: 403 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('INSERT INTO audit_logs'))).toBe(false);
    vi.mocked(PermissionService.prototype.assertCaseAssignment).mockResolvedValue(); s.h.auditFailure = true;
    await expect(s.attachment()).rejects.toThrow('audit failed');
  });
});
