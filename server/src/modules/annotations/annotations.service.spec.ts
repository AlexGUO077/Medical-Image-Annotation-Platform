import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { AnnotationsService } from './annotations.service';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { id: uid(1), username: 'synthetic', password_hash: 'unused', real_name: '合成', mfa_secret_encrypted: null, role: 'member', status: 'active', expire_at: '2099-12-31', must_change_password: false, quals: { resp: ['annotate', 'review'] }, updated_at: new Date('2026-01-01'), in_flight_limit: null } as AuthUser;
const caseId = uid(2), seriesId = uid(3), partId = uid(4), signId = uid(5), taskId = uid(6);
const annotation = { id: uid(7), series_id: seriesId, tool: 'box', geometry: { x: 1, y: 2, w: 10, h: 12 }, frame_start: 0, frame_end: 0, key_frame_index: 0,
  window_preset: 'lung', part_id: partId, confidence: 'typical', sign_tag_ids: [signId], report_sent_ids: [0] };
beforeEach(() => { vi.spyOn(PermissionService.prototype, 'assertCaseAssignment').mockResolvedValue(); });
afterEach(() => vi.restoreAllMocks());
function setup() {
  const h = { user: { ...actor }, task: { id: taskId, system_code: 'resp', review_mode: 'peer', dispatch_mode: 'manual', in_flight_limit: null },
    item: { id: caseId, system_code: 'resp', annotation_version: 1 }, objects: [{ ...annotation, confidence: '典型', version: 1, is_gold: false }],
    series: [{ id: seriesId, modality: 'CT', frame_count: 3, orthanc_id: 'private', series_uid: '2.25.123' }], parts: [{ id: partId }], signs: [{ id: signId }],
    sentences: [{ idx: 0, text: '合成结节' }], found: true, gold: false, auditFailure: false, active: [{ id: uid(8), task_role: 'annotate' }] };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return [h.user];
    if (sql.startsWith('SELECT t.id,t.system_code') || sql.startsWith('SELECT * FROM tasks')) return [h.task];
    if (sql.startsWith('SELECT c.id,c.system_code')) return [h.item];
    if (sql.startsWith('SELECT id FROM annotation_objects')) return h.gold ? [{ id: uid(7) }] : [];
    if (sql.startsWith('SELECT s.id,s.modality')) return h.series;
    if (sql.startsWith('SELECT n.id')) return h.parts;
    if (sql.startsWith('SELECT id FROM sign_tags')) return h.signs;
    if (sql.startsWith('SELECT sentences')) return [{ sentences: h.sentences }];
    if (sql.startsWith('SELECT a.logical_id')) return h.objects;
    if (sql.startsWith('SELECT EXISTS')) return [{ found: h.found }];
    if (sql.startsWith('SELECT id,reviewer_id')) return [];
    if (sql.startsWith('SELECT id,task_role')) return h.active;
    if (sql.startsWith('INSERT INTO annotation_objects')) return [{ id: uid(20) }];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit unavailable');
    void values; return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const orthanc = { resolveSeriesFrame: vi.fn().mockResolvedValue({ instance_id: 'private', frame_index: 0 }), frameGeometry: vi.fn().mockResolvedValue({ width: 64, height: 64 }) };
  const service = new AnnotationsService(db as never, orthanc as never);
  const save = (objects: unknown[] = [annotation], version = 1) => service.save(actor, caseId, { expected_version: version, annotations: objects }, 'local');
  return { h, query, db, orthanc, service, save };
}
describe('annotation versions, reference checks and submission', () => {
  it('creates a new version and audits counts without copying geometry to logs', async () => {
    const s = setup(); expect(await s.save()).toMatchObject({ version: 2 });
    const audit = s.query.mock.calls.find(c => c[0].startsWith('INSERT INTO audit_logs'))!;
    expect(JSON.parse(audit[1]![3] as string)).toEqual({ version: 2, previous_version: 1, object_count: 1 });
    expect(s.orthanc.frameGeometry).toHaveBeenCalledOnce();
    expect(s.query.mock.calls.some(c => /UPDATE annotation_objects|DELETE FROM annotation_objects/.test(c[0]))).toBe(false);
  });
  it('allows an explicitly empty draft and still advances its version', async () => {
    const s = setup(); s.h.series = []; s.h.parts = []; s.h.signs = []; s.h.objects = [];
    expect(await s.save([])).toMatchObject({ version: 2, annotations: [] });
  });
  it('blocks stale, overflow and gold versions before new object writes', async () => {
    const s = setup(); await expect(s.save([], 0)).rejects.toMatchObject({ status: 409 });
    s.h.item.annotation_version = 2147483647;
    await expect(s.save([], 2147483647)).rejects.toMatchObject({ status: 409 });
    s.h.item.annotation_version = 1; s.h.gold = true;
    await expect(s.save()).rejects.toMatchObject({ status: 409 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('INSERT'))).toBe(false);
  });
  it.each(['series', 'parts', 'signs'] as const)('rejects unavailable %s references', async field => {
    const s = setup(); s.h[field] = [];
    await expect(s.save()).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    { ...annotation, frame_end: 3 }, { ...annotation, window_preset: null }, { ...annotation, report_sent_ids: [99] },
    { ...annotation, geometry: { x: 60, y: 2, w: 10, h: 12 } },
    { ...annotation, tool: 'point', geometry: { x: 64, y: 3 } },
    { ...annotation, tool: 'polygon', geometry: { points: [[0, 0], [0, 64], [20, 20]] } },
    { ...annotation, tool: 'brush', geometry: { width: 32, height: 32, rle: [0, 1024] } },
  ])('rejects frame, CT window, report or geometric mismatch', async object => {
    const s = setup(); await expect(s.save([object])).rejects.toMatchObject({ status: 400 });
  });
  it('revalidates permission after reference I/O and does not advance a revoked draft', async () => {
    const s = setup(); vi.mocked(PermissionService.prototype.assertCaseAssignment).mockResolvedValueOnce().mockRejectedValueOnce(new Error('revoked'));
    await expect(s.save()).rejects.toThrow('revoked');
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE cases'))).toBe(false);
  });
  it('returns recorded historical versions but rejects absent and future versions', async () => {
    const s = setup(); expect(await s.service.read(actor, caseId, '1', 'local')).toMatchObject({ version: 1, current_version: 1, latest_review: null });
    await expect(s.service.read(actor, caseId, '2', 'local')).rejects.toMatchObject({ status: 404 });
    s.h.found = false; await expect(s.service.read(actor, caseId, '1', 'local')).rejects.toMatchObject({ status: 404 });
    await expect(s.service.read(actor, caseId, '-1', 'local')).rejects.toMatchObject({ status: 400 });
  });
  it('submits a complete version and leaves manual peer review awaiting dispatch', async () => {
    const s = setup();
    expect(await s.service.submit(actor, caseId, { expected_version: 1 }, 'local')).toMatchObject({ status: '待审核', version: 1, review: { reason: 'manual_dispatch', assignee_id: null } });
    expect(s.query.mock.calls.some(c => c[0].includes("SET state='completed'"))).toBe(true);
  });
  it('rejects incomplete report coverage, changed assignments, and lost self-review qualification', async () => {
    const s = setup(); s.h.sentences.push({ idx: 1, text: '合成积液' });
    await expect(s.service.submit(actor, caseId, { expected_version: 1 }, 'local')).rejects.toMatchObject({ status: 400 });
    s.h.sentences.pop(); s.h.active = [];
    await expect(s.service.submit(actor, caseId, { expected_version: 1 }, 'local')).rejects.toMatchObject({ status: 409 });
    s.h.task.review_mode = 'self'; s.h.user.quals = { resp: ['annotate'] };
    await expect(s.service.submit(actor, caseId, { expected_version: 1 }, 'local')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects stale sessions and propagates an audit failure', async () => {
    const s = setup(); s.h.user.updated_at = new Date('2026-01-02');
    await expect(s.save()).rejects.toMatchObject({ status: 403 });
    s.h.user.updated_at = actor.updated_at; s.h.auditFailure = true;
    await expect(s.save()).rejects.toThrow('audit unavailable');
  });
});
