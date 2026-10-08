import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { QualityReviewsService, decideQuality } from './quality-reviews';
import type { CapacityUser } from './review-assignment';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { id: uid(1), role: 'admin', quals: {}, status: 'active', expire_at: '2099-12-31', must_change_password: false, mfa_secret_encrypted: 'synthetic', updated_at: new Date('2026-01-01'), in_flight_limit: null } as CapacityUser;
const reviewer = { ...admin, id: uid(2), role: 'member', quals: { resp: ['review'] } } as CapacityUser;
const author = uid(3), caseId = uid(4), taskId = uid(5), assignmentId = uid(6);
function setup(count = 2) {
  const h = { users: [{ ...admin }, { ...reviewer }], task: { id: taskId, source: 'synthetic', system_code: 'resp', status: '进行中', review_mode: 'self', dispatch_mode: 'manual', in_flight_limit: null as number | null },
    candidates: Array.from({ length: count }, (_, n) => ({ case_id: uid(20 + n), version: 1, author })),
    item: { id: caseId, task_id: taskId, status: '已发布', source: 'synthetic', system_code: 'resp', annotation_version: 1, author },
    assignment: { id: assignmentId, case_id: caseId, assignee_id: reviewer.id as string | null, state: 'active', review_kind: 'spotcheck', review_version: 1, started_at: null as Date | null, expired: false },
    loads: [] as { assignee_id: string; global_count: number; task_count: number }[], expanded: false, prior: false, work: true, auditFailure: false };
  let sequence = 100;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return h.users;
    if (sql.startsWith('SELECT * FROM tasks')) return [h.task];
    if (sql.startsWith('SELECT c.id case_id')) return h.candidates;
    if (sql.startsWith('SELECT c.*,')) return [h.item];
    if (sql.startsWith('SELECT * FROM task_assignments') || sql.startsWith('SELECT *,due_at')) return [h.assignment];
    if (sql.startsWith('SELECT a.assignee_id,')) return h.loads;
    if (sql.startsWith('INSERT INTO task_assignments')) return [{ id: uid(sequence++) }];
    if (sql.startsWith('SELECT id,detail FROM audit_logs')) return [{ id: uid(9), detail: { candidates: h.candidates } }];
    if (sql.startsWith('SELECT id FROM audit_logs')) return h.expanded ? [{ id: uid(9) }] : [];
    if (sql.startsWith('SELECT c.id,c.annotation_version')) return h.candidates.map(t => ({ id: t.case_id, annotation_version: t.version, status: '已发布', author: t.author }));
    if (sql.startsWith('SELECT id FROM task_assignments')) return h.prior ? [{ id: uid(10) }] : [];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit unavailable');
    void values; return [];
  });
  const db = { query: vi.fn(async () => [{ found: h.work }]), transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const service = new QualityReviewsService(db as never);
  const decide = (kind: 'spotcheck' | 'recheck' = 'spotcheck', result = '打回') => decideQuality({ query } as never, h.users, h.task, h.item, { id: assignmentId, review_kind: kind }, result, reviewer.id, 'local');
  return { h, query, db, service, decide };
}
describe('quality review sampling, scope and recovery', () => {
  it.each([0, 1, 9, 10, 11])('samples ceil(10%%) of %i candidates without replacement', async count => {
    const s = setup(count), result = await s.service.sample(admin, taskId, {}, 'local');
    expect(result).toMatchObject({ candidate_count: count, sampled_count: Math.ceil(count / 10), assigned_count: Math.ceil(count / 10), pending_count: 0 });
    const inserts = s.query.mock.calls.filter(c => c[0].startsWith('INSERT INTO task_assignments'));
    expect(new Set(inserts.map(c => c[1]?.[0])).size).toBe(Math.ceil(count / 10));
    if (!count) expect(result.batch_id).toBeNull();
  });
  it('excludes the submitter even in self-review tasks and persists pending when nobody can take work', async () => {
    const s = setup(1); s.h.users[1]!.id = author;
    expect(await s.service.sample(admin, taskId, {}, 'local')).toMatchObject({ pending_count: 1, assigned_count: 0 });
    const insert = s.query.mock.calls.find(c => c[0].startsWith('INSERT INTO task_assignments'))!;
    expect(insert[1]?.slice(1, 4)).toEqual([null, 'pending', 'spotcheck']);
  });
  it('honors both global and task capacity', async () => {
    const s = setup(1); s.h.users[1]!.in_flight_limit = 1; s.h.loads = [{ assignee_id: reviewer.id, global_count: 1, task_count: 0 }];
    expect(await s.service.sample(admin, taskId, {}, 'local')).toMatchObject({ pending_count: 1 });
    s.h.users[1]!.in_flight_limit = null; s.h.task.in_flight_limit = 1; s.h.loads[0]!.task_count = 1;
    expect(await s.service.sample(admin, taskId, {}, 'local')).toMatchObject({ pending_count: 1 });
  });
  it('requires explicit started assignment and never changes the published case state on start', async () => {
    const s = setup(); expect(await s.service.start(reviewer, taskId, caseId, assignmentId, 'local')).toEqual({ case_id: caseId, status: '已发布' });
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE cases'))).toBe(false);
    s.h.assignment.started_at = new Date();
    await expect(s.service.start(reviewer, taskId, caseId, assignmentId, 'local')).rejects.toMatchObject({ status: 409 });
    s.h.assignment.started_at = null; s.h.assignment.review_version = 2;
    await expect(s.service.start(reviewer, taskId, caseId, assignmentId, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.item.status = '已下线';
    await expect(s.service.start(reviewer, taskId, caseId, assignmentId, 'local')).rejects.toMatchObject({ status: 409 });
  });
  it('fails closed for non-admin sampling, stale sessions and unsupported sources', async () => {
    const s = setup(); await expect(s.service.sample(reviewer, taskId, {}, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.users[0]!.updated_at = new Date('2026-01-02');
    await expect(s.service.sample(admin, taskId, {}, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.users[0]!.updated_at = admin.updated_at; s.h.task.source = 'teacher_provided_teaching';
    await expect(s.service.sample(admin, taskId, {}, 'local')).rejects.toMatchObject({ status: 403 });
    s.h.task.source = 'synthetic'; s.h.users[1]!.id = author;
    await expect(s.service.start({ ...reviewer, id: author } as AuthUser, taskId, caseId, assignmentId, 'local')).rejects.toMatchObject({ status: 403 });
  });
  it('only expands the failed sample author within this batch, preserving other published cases', async () => {
    const s = setup(3); s.h.candidates[0]!.case_id = caseId; s.h.candidates[2]!.author = uid(99);
    expect(await s.decide()).toEqual({ assigned_count: 1, pending_count: 0 });
    const inserts = s.query.mock.calls.filter(c => c[0].startsWith('INSERT INTO task_assignments'));
    expect(inserts).toHaveLength(1); expect(inserts[0]![1]?.[0]).toBe(s.h.candidates[1]!.case_id);
    const updates = s.query.mock.calls.filter(c => c[0].startsWith('UPDATE cases'));
    expect(updates).toHaveLength(1); expect(updates[0]![1]).toEqual([caseId]);
  });
  it('does not recursively expand a recheck or duplicate a previously expanded batch', async () => {
    const s = setup(); expect(await s.decide('recheck')).toEqual({ assigned_count: 0, pending_count: 0 });
    s.h.expanded = true; expect(await s.decide()).toEqual({ assigned_count: 0, pending_count: 0 });
    s.h.expanded = false; s.h.prior = true; expect(await s.decide()).toEqual({ assigned_count: 0, pending_count: 0 });
    expect(await s.decide('spotcheck', '通过')).toEqual({ assigned_count: 0, pending_count: 0 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('INSERT INTO task_assignments'))).toBe(false);
  });
  it('retries pending work, releases expired work, and cancels stale target versions', async () => {
    const s = setup(); s.h.assignment.state = 'pending'; s.h.assignment.assignee_id = null;
    await s.service.maintain();
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE task_assignments SET assignee_id=') && c[1]?.[1] === reviewer.id)).toBe(true);
    s.query.mockClear(); s.h.assignment.state = 'active'; s.h.assignment.assignee_id = reviewer.id; s.h.assignment.expired = true;
    await s.service.maintain(); expect(s.query.mock.calls.some(c => c[0].includes("SET state='pending'"))).toBe(true);
    s.query.mockClear(); s.h.item.annotation_version = 2;
    await s.service.maintain(); expect(s.query.mock.calls.some(c => c[0].includes("SET state='cancelled'"))).toBe(true);
  });
  it('leaves a valid active review unchanged and skips an empty queue', async () => {
    const s = setup(); await s.service.maintain();
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE'))).toBe(false);
    s.h.work = false; s.db.transaction.mockClear(); await s.service.maintain(); expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it('does not report a successful batch after an audit error', async () => {
    const s = setup(1); s.h.auditFailure = true;
    await expect(s.service.sample(admin, taskId, {}, 'local')).rejects.toThrow('audit unavailable');
  });
});
