import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { SearchService } from './search.service';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { id: uid(1), username: 'synthetic', password_hash: 'unused', real_name: '合成用户', mfa_secret_encrypted: null, role: 'member', status: 'active', expire_at: '2099-12-31', must_change_password: false, quals: { resp: ['annotate'] }, updated_at: new Date('2026-01-01') } as AuthUser;
beforeEach(() => { vi.spyOn(PermissionService.prototype, 'assertPublishedCase').mockResolvedValue(); });
afterEach(() => vi.restoreAllMocks());
function setup() {
  const h = { user: { ...actor }, available: true, tags: true, level: 2, items: [{ id: uid(2), version: 3 }] };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return [h.user];
    if (sql.startsWith('SELECT id,level')) return h.tags ? [{ id: values?.[0], level: values?.[0] === uid(4) ? 3 : h.level }] : [];
    if (sql.startsWith('SELECT id FROM sign_tags')) return h.tags ? [{ id: uid(5) }] : [];
    if (sql.startsWith('SELECT id,name')) return [{ id: uid(4), name: '合成疾病' }];
    if (sql.startsWith('SELECT c.annotation_version')) return h.available ? [{ annotation_version: 3, system_code: 'resp', disease_tag_id: uid(4), teaching_fields: {} }] : [];
    if (sql.startsWith('SELECT count')) return [{ total: h.items.length }];
    if (sql.startsWith('SELECT c.id,c.case_no')) return h.items;
    if (sql.includes(' AS key FROM cases')) return [{ key: uid(2) + ':3' }];
    return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const elastic = { match: vi.fn().mockResolvedValue([uid(2) + ':3']) };
  const workbench = { readInTransaction: vi.fn().mockResolvedValue({ series: [], sentences: [] }) };
  const service = new SearchService(db as never, elastic as never, workbench as never);
  return { h, query, elastic, workbench, service };
}
describe('published search authorization and output', () => {
  it('uses PostgreSQL rows and totals after text matching, with bounded pagination', async () => {
    const s = setup(); s.elastic.match.mockImplementation(async () => { s.h.items = []; return ['stale:3']; });
    expect(await s.service.search(actor, { q: '结节', page: '2', pageSize: '5' })).toEqual({ items: [], total: 0, page: 2, pageSize: 5 });
    expect(s.elastic.match).toHaveBeenCalledWith('结节', [uid(2) + ':3']);
    const rows = s.query.mock.calls.find(c => c[0].startsWith('SELECT c.id,c.case_no'))!;
    expect(rows[1]).toEqual([['resp'], ['stale:3'], 5, 5]);
  });
  it('supports combined tag/modality filters without invoking full-text search', async () => {
    const s = setup(); const result = await s.service.search(actor, { system_code: 'resp', part_id: uid(3), disease_id: uid(4), sign_tag_id: uid(5), modality: 'CT' });
    expect(result.total).toBe(1); expect(s.elastic.match).not.toHaveBeenCalled();
    expect(s.query.mock.calls.find(c => c[0].startsWith('SELECT count'))?.[1]).toEqual([['resp'], 'resp', uid(3), uid(4), uid(5), 'CT']);
  });
  it('rejects missing qualifications and missing/wrong-level tags', async () => {
    const s = setup(); s.h.user.quals = {};
    await expect(s.service.search(actor, {})).rejects.toMatchObject({ status: 403 });
    s.h.user.quals = actor.quals; s.h.tags = false;
    await expect(s.service.search(actor, { part_id: uid(3) })).rejects.toMatchObject({ status: 400 });
    s.h.tags = true; s.h.level = 1;
    await expect(s.service.search(actor, { part_id: uid(3) })).rejects.toMatchObject({ status: 400 });
  });
  it('rechecks revocation after external search before returning any results', async () => {
    const s = setup(); s.elastic.match.mockImplementation(async () => { s.h.user.status = 'disabled'; return []; });
    await expect(s.service.search(actor, { q: '结节' })).rejects.toMatchObject({ status: 403 });
  });
  it('reads only the authorized gold version and checks permission again after workbench I/O', async () => {
    const s = setup(); expect(await s.service.read(actor, uid(2), 'local')).toMatchObject({ version: 3, current_version: 3, annotations: [], disease: { id: uid(4) } });
    expect(s.workbench.readInTransaction).toHaveBeenCalledWith(expect.anything(), actor, uid(2), 'local', 'library', 3);
    vi.mocked(PermissionService.prototype.assertPublishedCase).mockClear().mockResolvedValueOnce().mockRejectedValueOnce(new ForbiddenException());
    await expect(s.service.read(actor, uid(2), 'local')).rejects.toMatchObject({ status: 403 });
  });
  it('denies unpublished and stale-session library reads', async () => {
    const s = setup(); s.h.available = false;
    await expect(s.service.read(actor, uid(2), 'local')).rejects.toMatchObject({ status: 403 });
    s.h.available = true; s.h.user.updated_at = new Date('2026-01-02');
    await expect(s.service.read(actor, uid(2), 'local')).rejects.toMatchObject({ status: 403 });
    expect(s.workbench.readInTransaction).not.toHaveBeenCalled();
  });
});
