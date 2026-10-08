import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { ExportsService } from './exports.service';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const requester = { id: uid(1), role: 'admin', status: 'active', expire_at: '2099-12-31', must_change_password: false, mfa_secret_encrypted: 'synthetic', updated_at: new Date('2026-01-01') } as AuthUser;
const approver = { ...requester, id: uid(2) }, caseId = uid(3), requestId = uid(4), seriesId = uid(5);
function setup() {
  const bytes = Buffer.from('{"schema_version":1,"cases":[]}');
  const h = { users: [{ ...requester }, { ...approver }], missing: false, versions: [{ id: caseId, version: 1 }], auditFailure: false,
    request: { id: requestId, requester_id: requester.id, approver_id: approver.id, case_versions: [{ id: caseId, version: 1 }], status: '待审批', expire_at: new Date('2099-01-01'), download_count: 0, package_sha256: createHash('sha256').update(bytes).digest('hex') },
    annotations: [{ id: uid(6), series_id: seriesId, tool: 'point', geometry: { x: 1, y: 2 }, frame_start: 0, frame_end: 0, key_frame_index: 0, window_preset: 'lung', part_id: null, sign_tag_ids: [], confidence: null, report_sent_ids: [0], version: 1, is_gold: true }] };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return h.users.filter(u => (values?.[0] as string[]).includes(u.id));
    if (sql.startsWith('SELECT * FROM export_requests')) return h.missing ? [] : [h.request];
    if (sql.startsWith('SELECT c.id,c.annotation_version')) return h.versions;
    if (sql.startsWith('SELECT id,source')) return [{ id: caseId, source: 'synthetic', system_code: 'resp', disease_tag_id: uid(7) }];
    if (sql.startsWith('SELECT a.logical_id')) return h.annotations;
    if (sql.startsWith('SELECT s.id')) return [{ id: seriesId, modality: 'CT', frame_count: 1, series_uid: 'private-uid', orthanc_id: 'private-orthanc', default_window: { center: 40, width: 400, internal: 'omit' } }];
    if (sql.startsWith('WITH ')) return [{ items: [], total: 0 }];
    if (sql.startsWith('INSERT INTO export_requests')) return [{ id: requestId, status: '待审批' }];
    if (sql.startsWith('UPDATE export_requests SET status=\'已批准')) return [{ id: requestId, status: '已批准', expire_at: h.request.expire_at }];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('audit failed');
    return [];
  });
  const db = { transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query })) };
  const objects = { storeJson: vi.fn().mockResolvedValue(undefined), readJson: vi.fn().mockResolvedValue(bytes) };
  const compensation = { reserve: vi.fn().mockResolvedValue('intent'), complete: vi.fn(), compensate: vi.fn() };
  const orthanc = { resolveSeriesFrame: vi.fn().mockResolvedValue({ instance_id: 'private-instance', frame_index: 0 }), frameGeometry: vi.fn().mockResolvedValue({ width: 512, height: 512, row_spacing: 1, column_spacing: 1, private: 'omit' }) };
  const service = new ExportsService(db as never, objects as never, compensation as never, orthanc as never);
  return { h, bytes, query, objects, compensation, service, approve: () => service.decide(approver, requestId, { decision: 'approve' }, 'local'), download: () => service.download(requester, requestId, 'local') };
}
describe('controlled exports and single-use retrieval', () => {
  it('lists bounded candidates and requests and freezes current versions at application', async () => {
    const s = setup(); expect(await s.service.candidates(requester, {})).toMatchObject({ total: 0, page: 1, pageSize: 20 });
    expect(await s.service.list(requester, { page: '2' })).toMatchObject({ page: 2 });
    expect(await s.service.create(requester, { case_ids: [caseId] }, 'local')).toEqual({ id: requestId, status: '待审批' });
    expect(s.query.mock.calls.find(c => c[0].startsWith('INSERT INTO export_requests'))?.[1]).toEqual([requester.id, JSON.stringify(s.h.versions)]);
  });
  it('rejects empty/duplicate/oversized requests and unavailable current versions', async () => {
    const s = setup();
    for (const ids of [[], [caseId, caseId], Array(21).fill(caseId)]) await expect(s.service.create(requester, { case_ids: ids }, 'local')).rejects.toMatchObject({ status: 400 });
    s.h.versions = []; await expect(s.service.create(requester, { case_ids: [caseId] }, 'local')).rejects.toMatchObject({ status: 403 });
  });
  it('requires another currently authorized administrator, and allows explicit rejection without storage', async () => {
    const s = setup(); await expect(s.service.decide(requester, requestId, { decision: 'approve' }, 'local')).rejects.toMatchObject({ status: 403 });
    expect(await s.service.decide(approver, requestId, { decision: 'reject' }, 'local')).toEqual({ id: requestId, status: '已拒绝' });
    expect(s.objects.storeJson).not.toHaveBeenCalled();
    s.h.users[0]!.status = 'disabled'; await expect(s.approve()).rejects.toMatchObject({ status: 403 });
  });
  it('exports only the approved projection and completes object compensation after success', async () => {
    const s = setup(); expect(await s.approve()).toMatchObject({ status: '已批准' });
    const body = JSON.parse(s.objects.storeJson.mock.calls[0]![1].toString());
    expect(body.cases[0].series[0]).toEqual({ id: seriesId, modality: 'CT', frame_count: 1, default_window: { center: 40, width: 400 }, frames: [{ frame_index: 0, width: 512, height: 512, row_spacing: 1, column_spacing: 1 }] });
    expect(JSON.stringify(body)).not.toMatch(/private-|raw_text|clinical_text|orthanc_id|series_uid/);
    expect(s.compensation.complete).toHaveBeenCalledWith('intent'); expect(s.compensation.compensate).not.toHaveBeenCalled();
  });
  it.each(['stale_version', 'foreign_series', 'unsafe_window', 'processed', 'missing'] as const)('refuses %s approvals before object creation', async kind => {
    const s = setup();
    if (kind === 'stale_version') s.h.versions[0]!.version = 2;
    if (kind === 'foreign_series') s.h.annotations[0]!.series_id = uid(99);
    if (kind === 'unsafe_window') s.h.annotations[0]!.window_preset = 'raw-report-text';
    if (kind === 'processed') s.h.request.status = '已批准';
    if (kind === 'missing') s.h.missing = true;
    await expect(s.approve()).rejects.toMatchObject({ status: kind === 'processed' ? 409 : kind === 'missing' ? 404 : kind === 'unsafe_window' ? 400 : 403 });
    expect(s.objects.storeJson).not.toHaveBeenCalled();
  });
  it('compensates a stored package if audit or post-I/O account expiry prevents approval', async () => {
    const s = setup(); s.h.auditFailure = true; await expect(s.approve()).rejects.toThrow('audit failed');
    expect(s.compensation.compensate).toHaveBeenCalledWith('intent');
    s.h.auditFailure = false; s.objects.storeJson.mockImplementation(async () => { s.h.users[0]!.expire_at = '2000-01-01'; });
    await expect(s.approve()).rejects.toMatchObject({ status: 403 });
    expect(s.compensation.complete).not.toHaveBeenCalled();
  });
  it('marks retrieval consumed only after a successful integrity and permission check', async () => {
    const s = setup(); s.h.request.status = '已批准'; expect(await s.download()).toEqual(s.bytes);
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE export_requests SET download_count=1'))).toBe(true);
  });
  it.each(['expired', 'used', 'version', 'approver', 'requester', 'pending', 'read', 'hash', 'late_expiry'] as const)('withholds bytes and preserves the allowance after %s failure', async kind => {
    const s = setup(); s.h.request.status = '已批准';
    if (kind === 'expired') s.h.request.expire_at = new Date('2000-01-01');
    if (kind === 'used') s.h.request.download_count = 1;
    if (kind === 'version') s.h.versions[0]!.version = 2;
    if (kind === 'approver') s.h.users[1]!.role = 'member';
    if (kind === 'requester') s.h.request.requester_id = approver.id;
    if (kind === 'pending') s.h.request.status = '待审批';
    if (kind === 'read') s.objects.readJson.mockRejectedValue(new Error('object offline'));
    if (kind === 'hash') s.objects.readJson.mockResolvedValue(Buffer.from('tampered'));
    if (kind === 'late_expiry') s.objects.readJson.mockImplementation(async () => { s.h.request.expire_at = new Date('2000-01-01'); return s.bytes; });
    await expect(s.download()).rejects.toMatchObject({ status: ['read', 'hash'].includes(kind) ? 503 : 403 });
    expect(s.query.mock.calls.some(c => c[0].startsWith('UPDATE export_requests SET download_count=1'))).toBe(false);
    expect(s.query.mock.calls.some(c => c[1]?.[1] === 'exports.download_denied')).toBe(true);
  });
});
