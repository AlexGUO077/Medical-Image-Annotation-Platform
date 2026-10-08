import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { ReviewsService } from './reviews.service';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { id: uid(1), username: 'synthetic', password_hash: 'unused', real_name: '合成', mfa_secret_encrypted: null, role: 'member', status: 'active', expire_at: '2099-12-31', must_change_password: false, quals: { resp: ['review'] }, updated_at: new Date('2026-01-01'), in_flight_limit: null } as AuthUser;
const author = { ...actor, id: uid(2), quals: { resp: ['annotate', 'review'] }, in_flight_limit: null as number | null } as AuthUser & { in_flight_limit: number | null };
const caseId = uid(3), checks = { kind: 'checks', deidentification: true, confirmation_basis: true, disease_label: true };
beforeEach(() => { vi.spyOn(PermissionService.prototype, 'assertCaseAssignment').mockResolvedValue(); });
afterEach(() => vi.restoreAllMocks());
function setup() {
  const h = { current: { ...actor }, author: { ...author }, task: { id: uid(4), system_code: 'resp', review_mode: 'peer', in_flight_limit: null as number | null },
    item: { id: caseId, system_code: 'resp', status: '审核中', annotation_version: 1, disease_tag_id: uid(5), author: author.id },
    assignments: [{ id: uid(6), task_role: 'review', assignee_id: actor.id, review_kind: 'normal', review_version: 1, started_at: new Date() }],
    objects: [{ id: uid(7), is_gold: false, confidence: '典型' }], disease: [{ id: uid(5), name: '合成疾病' }], found: true,
    previous: [] as { reviewer_id: string; comments: { annotation_version: number }[] }[], load: { global_count: 0, task_count: 0 }, auditFailure: false };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return sql.includes('WHERE id=$1') ? [h.current] : [h.current, h.author];
    if (sql.startsWith('SELECT t.*')) return [h.task];
    if (sql.startsWith('SELECT c.*,')) return [h.item];
    if (sql.startsWith('SELECT * FROM task_assignments') || sql.startsWith('SELECT id,task_role')) return h.assignments;
    if (sql.startsWith('SELECT a.logical_id')) return h.objects;
    if (sql.startsWith('SELECT n.id') || sql.startsWith('SELECT id,name')) return h.disease;
    if (sql.startsWith('SELECT EXISTS')) return [{ found: h.found }];
    if (sql.startsWith('SELECT id,reviewer_id')) return h.previous;
    if (sql.startsWith('SELECT clock_timestamp')) return [{ now: new Date('2026-10-08T00:00:00Z') }];
    if (sql.startsWith('INSERT INTO reviews') || sql.startsWith('INSERT INTO task_assignments')) return [{ id: uid(8) }];
    if (sql.startsWith('SELECT count(*)::int global_count')) return [h.load];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit unavailable');
    void values; return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const workbench = { readInTransaction: vi.fn().mockResolvedValue({ case: { id: caseId }, sentences: [], series: [] }) };
  const service = new ReviewsService(db as never, workbench as never);
  const decide = (result = '通过', extra = {}) => service.decide(actor, caseId, { expected_version: 1, result, comments: result === '通过' ? [checks] : [checks, { kind: 'overall', text: '请修正合成轮廓' }], ...extra }, 'local');
  return { h, query, db, workbench, service, decide };
}
describe('review outcomes and authorization transitions', () => {
  it('publishes and locks the current version with server-owned comment metadata', async () => {
    const s = setup(); expect(await s.decide()).toMatchObject({ status: '已发布', is_gold: true, reannotation: null });
    const insert = s.query.mock.calls.find(c => c[0].startsWith('INSERT INTO reviews'))!;
    expect(JSON.parse(insert[1]![3] as string)[0]).toMatchObject({ reviewer_id: actor.id, annotation_version: 1, created_at: '2026-10-08T00:00:00.000Z' });
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE annotation_objects SET is_gold=true'))).toBe(true);
  });
  it('returns to the original eligible annotator without changing the old objects', async () => {
    const s = setup(); expect(await s.decide('打回')).toMatchObject({ status: '标注中', is_gold: false, reannotation: { assignee_id: author.id, reason: null } });
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE annotation_objects'))).toBe(false);
  });
  it.each(['account_unavailable', 'qualification_removed', 'capacity_full'])('returns to pending allocation for %s', async reason => {
    const s = setup();
    if (reason === 'account_unavailable') s.h.author.status = 'disabled';
    if (reason === 'qualification_removed') s.h.author.quals = {};
    if (reason === 'capacity_full') { s.h.author.in_flight_limit = 1; s.h.load.global_count = 1; }
    expect(await s.decide('打回')).toMatchObject({ status: '待分配', reannotation: { assignee_id: null, reason } });
  });
  it('reads current/history with diagnosis but denies unknown versions and late authorization loss', async () => {
    const s = setup(); expect(await s.service.read(actor, caseId, '1', 'local')).toMatchObject({ version: 1, current_version: 1, disease: s.h.disease[0], latest_review: null });
    await expect(s.service.read(actor, caseId, '2', 'local')).rejects.toMatchObject({ status: 404 });
    s.h.found = false; await expect(s.service.read(actor, caseId, '1', 'local')).rejects.toMatchObject({ status: 404 });
    await expect(s.service.read(actor, caseId, 'bad', 'local')).rejects.toMatchObject({ status: 400 });
    s.h.found = true; vi.mocked(PermissionService.prototype.assertCaseAssignment).mockResolvedValueOnce().mockRejectedValueOnce(new Error('deadline passed'));
    await expect(s.service.read(actor, caseId, undefined, 'local')).rejects.toThrow('deadline passed');
  });
  it.each(['stale', 'self', 'state', 'version', 'gold', 'disease', 'assignment'])('denies changed %s before committing review', async reason => {
    const s = setup();
    if (reason === 'stale') s.h.current.updated_at = new Date('2026-01-02');
    if (reason === 'self') s.h.item.author = actor.id;
    if (reason === 'state') s.h.item.status = '待审核';
    if (reason === 'version') s.h.item.annotation_version = 2;
    if (reason === 'gold') s.h.objects[0]!.is_gold = true;
    if (reason === 'disease') s.h.disease = [];
    if (reason === 'assignment') s.h.assignments[0]!.assignee_id = author.id;
    await expect(s.decide()).rejects.toThrow();
    expect(s.query.mock.calls.some(c => c[0].startsWith('INSERT INTO reviews'))).toBe(false);
  });
  it('rejects cross-object comments and mismatched quality assignment IDs', async () => {
    const s = setup();
    await expect(s.decide('打回', { comments: [checks, { kind: 'object', annotation_id: uid(99), text: '修正' }] })).rejects.toMatchObject({ status: 400 });
    s.h.item.status = '已发布'; s.h.assignments[0]!.review_kind = 'spotcheck';
    await expect(s.decide()).rejects.toMatchObject({ status: 409 });
    expect(await s.service.read(actor, caseId, undefined, 'local')).toMatchObject({ review_kind: 'spotcheck', assignment_id: uid(6) });
    expect(await s.decide('通过', { assignment_id: uid(6) })).toMatchObject({ status: '已发布', review_kind: 'spotcheck', assigned_count: 0 });
  });
  it('identifies a duplicate completed conclusion and propagates failed audit writes', async () => {
    const s = setup(); s.h.assignments = []; s.h.previous = [{ reviewer_id: actor.id, comments: [{ annotation_version: 1 }] }];
    await expect(s.decide()).rejects.toMatchObject({ status: 409 });
    const other = setup(); other.h.auditFailure = true;
    await expect(other.decide()).rejects.toThrow('audit unavailable');
  });
});
