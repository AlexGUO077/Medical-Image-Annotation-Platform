import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { CasesLifecycleService } from './cases-lifecycle.service';
const id = '00000000-0000-4000-8000-000000000001';
const actor = { id, mfa_secret_encrypted: 'synthetic', role: 'admin', status: 'active', expire_at: '2099-12-31', must_change_password: false, updated_at: new Date('2026-01-01') } as AuthUser;
function setup() {
  const h = { user: { ...actor }, item: { source: 'synthetic', confirmed: true, status: '已发布', annotation_version: 2, system_code: 'resp' },
    tasks: [{ id: 'task', status: '进行中', source: 'synthetic', system_code: 'resp' }], active: [] as { id: string; state: string; assignee_id: string | null; task_role: string }[], missing: false, lateRevocation: false, auditFailure: false };
  let checks = 0;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) { checks++; return [{ ...h.user, ...(h.lateRevocation && checks > 1 ? { status: 'disabled' } : {}) }]; }
    if (sql.startsWith('SELECT t.*')) return h.tasks;
    if (sql.startsWith('SELECT c.*')) return h.missing ? [] : [h.item];
    if (sql.startsWith('SELECT id,assignee_id')) return h.active;
    if (sql.startsWith('INSERT INTO annotation_objects')) return [{ id: 'copy' }];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit failed');
    void values; return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const service = new CasesLifecycleService(db as never);
  return { h, query, run: (action: 'offline' | 'reactivate' = 'offline', version = 2) => service.change(actor, id, { expected_version: version }, action, 'local') };
}
describe('case offline and reactivation boundaries', () => {
  it('releases active and cancels pending work while preserving the published version', async () => {
    const s = setup(); s.h.active = [{ id: 'a', state: 'active', assignee_id: id, task_role: 'review' }, { id: 'b', state: 'pending', assignee_id: null, task_role: 'review' }];
    expect(await s.run()).toEqual({ case_id: id, status: '已下线', version: 2 });
    expect(s.query.mock.calls.filter(c => c[0].startsWith('UPDATE task_assignments')).map(c => c[1])).toEqual([['a', 'released'], ['b', 'cancelled']]);
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE annotation_objects'))).toBe(false);
  });
  it('seeds a new editable version and records its origin without changing old gold', async () => {
    const s = setup(); s.h.item.status = '已下线';
    expect(await s.run('reactivate')).toEqual({ case_id: id, status: '待分配', version: 3 });
    expect(s.query.mock.calls.find(c => c[0].startsWith('INSERT INTO annotation_objects'))?.[1]).toEqual([id, 2, 3]);
    const audit = s.query.mock.calls.find(c => c[1]?.[1] === 'annotations.seeded');
    expect(JSON.parse(audit?.[1]?.[3] as string)).toMatchObject({ previous_version: 2, version: 3, object_count: 1 });
  });
  it.each(['source', 'confirmation', 'version', 'state', 'missing', 'admin', 'stale', 'late'] as const)('rejects invalid %s before returning success', async kind => {
    const s = setup();
    if (kind === 'source') s.h.item.source = 'teacher_provided_teaching';
    if (kind === 'confirmation') s.h.item.confirmed = false;
    if (kind === 'version') s.h.item.annotation_version = 3;
    if (kind === 'state') s.h.item.status = '标注中';
    if (kind === 'missing') s.h.missing = true;
    if (kind === 'admin') s.h.user.role = 'member';
    if (kind === 'stale') s.h.user.updated_at = new Date('2026-01-02');
    if (kind === 'late') s.h.lateRevocation = true;
    await expect(s.run()).rejects.toMatchObject({ status: kind === 'missing' ? 404 : ['version', 'state'].includes(kind) ? 409 : 403 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE cases'))).toBe(false);
  });
  it.each(['missing', 'multiple', 'closed', 'system', 'source', 'assignment', 'overflow'] as const)('refuses reactivation with %s original task/version', async kind => {
    const s = setup(); s.h.item.status = '已下线';
    if (kind === 'missing') s.h.tasks = [];
    if (kind === 'multiple') s.h.tasks.push({ ...s.h.tasks[0]! });
    if (kind === 'closed') s.h.tasks[0]!.status = '已结束';
    if (kind === 'system') s.h.tasks[0]!.system_code = 'digestive';
    if (kind === 'source') s.h.tasks[0]!.source = 'teacher_provided_teaching';
    if (kind === 'assignment') s.h.active.push({ id, state: 'active', assignee_id: id, task_role: 'annotate' });
    if (kind === 'overflow') s.h.item.annotation_version = 2147483647;
    await expect(s.run('reactivate', s.h.item.annotation_version)).rejects.toMatchObject({ status: 409 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('INSERT INTO annotation_objects'))).toBe(false);
  });
  it('propagates an audit failure to the transaction caller', async () => {
    const s = setup(); s.h.auditFailure = true;
    await expect(s.run()).rejects.toThrow('audit failed');
  });
});
