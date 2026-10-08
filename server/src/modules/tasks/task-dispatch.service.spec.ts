import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { TaskDispatchService } from './task-dispatch.service';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { id: uid(1), role: 'admin', quals: {}, status: 'active', expire_at: '2099-12-31', must_change_password: false, mfa_secret_encrypted: 'synthetic', updated_at: new Date('2026-01-01'), in_flight_limit: null } as AuthUser & { in_flight_limit: number | null };
const member = { ...admin, id: uid(2), role: 'member' as const, quals: { resp: ['annotate', 'review'] } } as typeof admin;
const caseId = uid(3), taskId = uid(4), assignmentId = uid(5);
function setup() {
  const h = {
    users: [{ ...admin }, { ...member }],
    task: { id: taskId, status: '进行中', source: 'synthetic', system_code: 'resp', review_mode: 'peer', dispatch_mode: 'manual', in_flight_limit: null as number | null, priority: 1 },
    cases: [{ id: caseId, task_id: taskId, source: 'synthetic', system_code: 'resp', status: '待分配', author: uid(9) }],
    links: [{ id: uid(6), case_id: caseId }], active: [] as { id: string }[],
    loads: [] as { assignee_id: string; task_id: string; n: number }[], load: { global_count: 0, task_count: 0 },
    assignment: { id: assignmentId, assignee_id: member.id, task_role: 'annotate', review_kind: 'normal', state: 'active', overdue: false },
    cursor: true, failAudit: false,
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM users')) return sql.includes('WHERE id=') && !sql.includes('ANY') ? h.users.filter(u => u.id === values?.[0]) : h.users;
    if (sql.startsWith('SELECT * FROM tasks')) return [h.task];
    if (sql.startsWith('SELECT tc.case_id')) return h.cursor ? h.links : [];
    if (sql.startsWith('SELECT c.id,c.status') || sql.startsWith('SELECT id, source') || sql.startsWith('SELECT * FROM cases') || sql.startsWith('SELECT c.*,') || sql.startsWith('SELECT c.id,(SELECT')) return h.cases;
    if (sql.startsWith('SELECT case_id FROM task_cases') || sql.startsWith('SELECT id FROM task_cases')) return h.links;
    if (sql.startsWith('SELECT id FROM task_assignments')) return sql.includes('assignee_id=$2') ? [h.assignment] : h.active;
    if (sql.startsWith('SELECT *, (due_at')) return [h.assignment];
    if (sql.startsWith('SELECT count(*)::int AS global_count')) return [h.load];
    if (sql.startsWith('SELECT a.assignee_id,')) return h.loads;
    if (sql.startsWith('SELECT count(*)::int total')) return [{ total: h.cases.length }];
    if (sql.startsWith('SELECT t.id task_id')) return h.cases;
    if (sql.startsWith('INSERT INTO audit_logs') && h.failAudit) throw new Error('audit unavailable');
    return [];
  });
  const db = { query: vi.fn().mockResolvedValue([{ assignee_id: member.id, case_id: caseId, task_id: taskId }]),
    transaction: vi.fn(async (...args: unknown[]) => (args.at(-1) as (m: unknown) => unknown)({ query })) };
  const service = new TaskDispatchService(db as never);
  const manual = { mode: 'manual', task_id: taskId, assignee_id: member.id, case_ids: [caseId] };
  return { h, query, db, service, manual };
}
describe('dispatch decisions, capacity and live state', () => {
  it('manually assigns an available qualified member and keeps the explicit deadline', async () => {
    const s = setup();
    const result = await s.service.dispatch(admin, { ...s.manual, due_at: '2099-01-01T08:00:00+08:00' }, 'local');
    expect(result).toMatchObject({ assignee_id: member.id, case_ids: [caseId], due_at: '2099-01-01T00:00:00.000Z', task_role: 'annotate' });
    expect(s.query.mock.calls.some(call => call[0].startsWith('UPDATE cases') && call[1]?.[1] === '标注中')).toBe(true);
  });
  it('enforces the smaller task/global capacity before any assignment insert', async () => {
    for (const global of [true, false]) {
      const s = setup(); s.h.load = { global_count: 2, task_count: 2 };
      if (global) s.h.users[1]!.in_flight_limit = 2; else s.h.task.in_flight_limit = 2;
      await expect(s.service.dispatch(admin, s.manual, 'local')).rejects.toMatchObject({ status: 409 });
      expect(s.query.mock.calls.some(call => call[0].startsWith('INSERT'))).toBe(false);
    }
  });
  it.each(['stale', 'disabled', 'qualification', 'self', 'case', 'links', 'active', 'task'])('rejects changed %s before dispatch', async kind => {
    const s = setup();
    if (kind === 'stale') s.h.users[0]!.updated_at = new Date('2026-01-02');
    if (kind === 'disabled') s.h.users[1]!.status = 'disabled';
    if (kind === 'qualification') s.h.users[1]!.quals = {};
    if (kind === 'self') { s.h.task.review_mode = 'self'; s.h.users[1]!.quals = { resp: ['annotate'] }; }
    if (kind === 'case') s.h.cases[0]!.status = '已发布';
    if (kind === 'links') s.h.links = [];
    if (kind === 'active') s.h.active = [{ id: assignmentId }];
    if (kind === 'task') s.h.task.status = '已结束';
    await expect(s.service.dispatch(admin, s.manual, 'local')).rejects.toThrow();
    expect(s.query.mock.calls.some(call => call[0].startsWith('INSERT'))).toBe(false);
  });
  it('pool claims bind the current member and review claims explicitly enter review', async () => {
    const s = setup(); s.h.task.dispatch_mode = 'pool'; s.h.cases[0]!.status = '待审核';
    const result = await s.service.dispatch(member, { mode: 'pool', task_id: taskId, case_id: caseId, task_role: 'review' }, 'local');
    expect(result).toMatchObject({ assignee_id: member.id, task_role: 'review' });
    expect(s.query.mock.calls.some(call => call[0].startsWith('UPDATE cases') && call[1]?.[1] === '审核中')).toBe(true);
    s.h.cases[0]!.author = member.id;
    await expect(s.service.dispatch(member, { mode: 'pool', task_id: taskId, case_id: caseId, task_role: 'review' }, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.task.dispatch_mode = 'manual';
    await expect(s.service.dispatch(member, { mode: 'pool', task_id: taskId, case_id: caseId }, 'local')).rejects.toMatchObject({ status: 409 });
  });
  it('automatically balances load, counts new assignments, and preserves pending cases at capacity', async () => {
    const s = setup(); s.h.task.dispatch_mode = 'auto'; s.h.task.in_flight_limit = 1;
    s.h.users.push({ ...member, id: uid(7) });
    s.h.cases.push({ ...s.h.cases[0]!, id: uid(10) }, { ...s.h.cases[0]!, id: uid(11) });
    const result = await s.service.dispatch(admin, { mode: 'auto', task_id: taskId }, 'local');
    if (!('assigned' in result)) throw new Error('Expected automatic dispatch result');
    expect(result.assigned).toEqual([{ case_id: caseId, task_id: taskId, assignee_id: member.id }, { case_id: uid(10), task_id: taskId, assignee_id: uid(7) }]);
    expect(result.unassigned).toEqual([{ case_id: uid(11), reason: 'capacity_full' }]);
    expect(result.next_case_id).toBeNull();
  });
  it('background auto dispatch handles peer-review separation, existing global load and invalid cursors', async () => {
    const s = setup(); s.h.task.dispatch_mode = 'auto';
    s.h.cases[0]!.status = '待审核'; s.h.cases[0]!.author = member.id;
    expect((await s.service.maintainAutomatic()).unassigned).toEqual([{ case_id: caseId, reason: 'no_eligible_assignee' }]);
    s.h.users.push({ ...member, id: uid(7), in_flight_limit: 1 });
    s.h.loads = [{ assignee_id: uid(7), task_id: uid(99), n: 1 }];
    expect((await s.service.maintainAutomatic()).unassigned[0]?.reason).toBe('capacity_full');
    s.h.loads = [];
    expect((await s.service.maintainAutomatic(caseId)).assigned[0]?.assignee_id).toBe(uid(7));
    s.h.cursor = false;
    await expect(s.service.maintainAutomatic(caseId)).rejects.toMatchObject({ status: 400 });
  });
  it('reports automatic follow-up failure as pending without reversing prior creation', async () => {
    const s = setup();
    expect(await s.service.autoAfter(admin, taskId, 'local')).toEqual({ status: 'pending' });
    s.h.task.dispatch_mode = 'auto';
    expect(await s.service.autoAfter(admin, taskId, 'local')).toMatchObject({ status: 'completed' });
  });
  it('updates capacity without revoking a login and preserves unspecified task settings', async () => {
    const s = setup();
    expect(await s.service.settings(admin, taskId, { in_flight_limit: 2 }, 'local')).toEqual({ id: taskId, priority: 1, in_flight_limit: 2, dispatch_mode: 'manual' });
    expect(await s.service.personLimit(admin, member.id, { in_flight_limit: null }, 'local')).toEqual({ id: member.id, in_flight_limit: null });
    const update = s.query.mock.calls.find(call => call[0].startsWith('UPDATE users'))!;
    expect(update[0]).not.toContain('updated_at');
  });
  it.each(['annotate', 'review'])('returns a bounded %s queue under the current qualifications', async role => {
    const s = setup();
    for (const mine of [true, false]) expect(await s.service.queue(member, { task_role: role, page: '2', pageSize: '10' }, mine)).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    const read = s.query.mock.calls.find(call => call[0].startsWith('SELECT t.id task_id'))!;
    expect(read[1]?.slice(-2)).toEqual([10, 10]);
  });
  it('starts only a valid assigned peer review', async () => {
    const s = setup(); s.h.users = [{ ...member }]; s.h.cases[0]!.status = '待审核';
    expect(await s.service.startReview(member, { task_id: taskId, case_id: caseId }, 'local')).toEqual({ case_id: caseId, status: '审核中' });
    s.h.cases[0]!.author = member.id;
    await expect(s.service.startReview(member, { task_id: taskId, case_id: caseId }, 'local')).rejects.toMatchObject({ status: 403 });
  });
  it.each(['normal', 'spotcheck'])('reclaims %s while preserving quality publication', async kind => {
    const s = setup(); s.h.assignment.review_kind = kind;
    s.h.cases[0]!.status = kind === 'normal' ? '标注中' : '已发布';
    if (kind !== 'normal') s.h.assignment.task_role = 'review';
    await expect(s.service.reclaim(admin, { assignment_id: assignmentId, reason: 'overdue' }, 'local')).rejects.toMatchObject({ status: 409 });
    expect(await s.service.reclaim(admin, { assignment_id: assignmentId, reason: 'quality' }, 'local')).toMatchObject({ state: kind === 'normal' ? 'released' : 'pending' });
    const writes = s.query.mock.calls.filter(call => call[0].startsWith('UPDATE cases'));
    expect(writes.length).toBe(kind === 'normal' ? 1 : 0);
  });
  it('propagates audit failure instead of returning success', async () => {
    const s = setup(); s.h.failAudit = true;
    await expect(s.service.dispatch(admin, s.manual, 'local')).rejects.toThrow('audit unavailable');
  });
  it.each([null, {}, { mode: 'manual', case_ids: [] }, { mode: 'pool', case_id: 'bad' }, { mode: 'manual', task_role: 'admin' }])('rejects malformed dispatch %j', async body => {
    const s = setup(); await expect(s.service.dispatch(admin, body, 'local')).rejects.toMatchObject({ status: 400 });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid settings, limits, pagination, mode and past deadlines', async () => {
    const s = setup();
    for (const input of [{}, { priority: 1.2 }, { dispatch_mode: 'bad' }, { in_flight_limit: 0 }]) await expect(s.service.settings(admin, taskId, input, 'local')).rejects.toMatchObject({ status: 400 });
    await expect(s.service.personLimit(admin, member.id, { in_flight_limit: -1 }, 'local')).rejects.toMatchObject({ status: 400 });
    for (const query of [{ page: '0' }, { pageSize: '101' }, { source: 'other' }, { task_role: 'admin' }]) await expect(s.service.queue(member, query, true)).rejects.toMatchObject({ status: 400 });
    await expect(s.service.dispatch(admin, { ...s.manual, case_ids: [caseId, caseId] }, 'local')).rejects.toMatchObject({ status: 400 });
    await expect(s.service.dispatch(admin, { ...s.manual, due_at: '2000-01-01T00:00:00Z' }, 'local')).rejects.toMatchObject({ status: 400 });
    await expect(s.service.dispatch(member, s.manual, 'local')).rejects.toMatchObject({ status: 403 });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
});
