import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { FramesService } from './frames.service';
import { FrameTicketService } from './frame-ticket.service';

const actor = { id: '00000000-0000-4000-8000-000000000001', username: 'synthetic-viewer', password_hash: 'unused', mfa_secret_encrypted: null, real_name: '合成查看员', role: 'member', status: 'active',
  expire_at: '2099-12-31', must_change_password: false, quals: { resp: ['annotate', 'review'] }, updated_at: new Date('2026-01-01') } as AuthUser;
const target = { case_id: '00000000-0000-4000-8000-000000000002', series_uid: '2.25.123', frame_index: 0 };
const bearer = 'synthetic-session';
beforeEach(() => {
  vi.stubEnv('FRAME_TOKEN_SECRET', 'synthetic-frame-service-'.repeat(3));
  vi.stubEnv('JWT_SECRET', 'synthetic-login-service-'.repeat(3));
  vi.spyOn(PermissionService.prototype, 'assertCaseAssignment').mockResolvedValue();
  vi.spyOn(PermissionService.prototype, 'assertPublishedCase').mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function setup() {
  const pixels = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#777777' } }).png().toBuffer();
  const h = { current: { ...actor }, series: { id: 'series', orthanc_id: 'private-orthanc', series_uid: target.series_uid, frame_count: 2,
    default_window: { center: 40, width: 400 }, modality: 'CT', system_code: 'resp', source: 'synthetic', status: '标注中', annotation_version: 1 }, auditFailure: false };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT *,expire_at')) return h.current ? [h.current] : [];
    if (sql.includes('FROM series s')) return [{ ...h.series }];
    if (sql.startsWith('INSERT INTO audit_logs') && h.auditFailure) throw new Error('synthetic audit failure');
    if (sql.startsWith('UPDATE users')) h.current = { ...h.current, status: 'disabled' };
    void values; return [];
  });
  const db = { transaction: vi.fn(async (work: (manager: unknown) => unknown) => work({ query })) };
  const rate = { configuration: vi.fn(), allow: vi.fn().mockResolvedValue(true) };
  const cache = { render: vi.fn().mockResolvedValue(pixels) };
  const orthanc = { resolveSeriesFrame: vi.fn().mockResolvedValue({ instance_id: 'instance', frame_index: 0 }), frameGeometry: vi.fn().mockResolvedValue({ width: 64, height: 64, pixel_spacing: [1, 1] }) };
  const service = new FramesService(db as never, rate as never, cache as never, orthanc as never);
  const issue = (input = target) => service.issue(actor, bearer, input, 'local');
  const token = async () => (await issue()).url.slice('/api/frames/'.length);
  return { h, query, db, rate, cache, orthanc, service, issue, token, pixels };
}
describe('frame service output and live authorization', () => {
  it('binds the effective default window, renders watermarked PNG and audits before output', async () => {
    const s = await setup(), ticket = await s.issue();
    const claims = new FrameTicketService().verify(ticket.url.slice('/api/frames/'.length), { user_id: actor.id, access_token: bearer });
    expect(claims.window).toEqual(s.h.series.default_window);
    const output = await s.service.read(actor, bearer, ticket.url.slice('/api/frames/'.length), 'local');
    expect(output.geometry.width).toBe(64);
    expect(await sharp(output.bytes).metadata()).toMatchObject({ format: 'png', width: 64, height: 64 });
    expect(await sharp(output.bytes).removeAlpha().raw().toBuffer()).not.toEqual(await sharp(s.pixels).removeAlpha().raw().toBuffer());
    const audits = s.query.mock.calls.filter(c => c[0].startsWith('INSERT INTO audit_logs'));
    expect(audits.map(c => c[1]?.[1])).toEqual(['frames.ticket_issued', 'frames.viewed']);
    expect(JSON.stringify(audits)).not.toContain(bearer);
    expect(PermissionService.prototype.assertCaseAssignment).toHaveBeenCalledTimes(3);
  });
  it('rechecks revocation after expensive rendering and never returns cached pixels', async () => {
    const s = await setup(), token = await s.token();
    s.cache.render.mockImplementation(async () => { s.h.current = { ...actor, status: 'disabled' }; return s.pixels; });
    await expect(s.service.read(actor, bearer, token, 'local')).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.query.mock.calls.filter(c => c[1]?.[1] === 'frames.viewed')).toHaveLength(0);
  });
  it('rejects a changed series identity after rendering', async () => {
    const s = await setup(), token = await s.token();
    s.cache.render.mockImplementation(async () => { s.h.series.orthanc_id = 'replacement'; return s.pixels; });
    await expect(s.service.read(actor, bearer, token, 'local')).rejects.toThrow('帧资源已变化');
  });
  it('denies output for mismatched DICOM dimensions and audit failure', async () => {
    const s = await setup(), token = await s.token();
    s.orthanc.frameGeometry.mockResolvedValueOnce({ width: 65, height: 64, pixel_spacing: [1, 1] });
    await expect(s.service.read(actor, bearer, token, 'local')).rejects.toBeInstanceOf(ServiceUnavailableException);
    s.h.auditFailure = true;
    await expect(s.service.read(actor, bearer, token, 'local')).rejects.toThrow('synthetic audit failure');
    await expect(s.issue()).rejects.toThrow('synthetic audit failure');
  });
  it.each(['ticket', 'read'])('locks an exceeded account before reporting 429 at %s', async phase => {
    const s = await setup(), token = phase === 'read' ? await s.token() : '';
    s.rate.allow.mockResolvedValue(false);
    await expect(phase === 'read' ? s.service.read(actor, bearer, token, 'local') : s.issue()).rejects.toMatchObject({ status: 429 });
    expect(s.h.current.status).toBe('disabled');
    expect(s.cache.render).not.toHaveBeenCalled();
    expect(s.query.mock.calls.some(c => c[1]?.[1] === 'frames.locked')).toBe(true);
  });
  it('uses current publication/version authorization for library frames', async () => {
    const s = await setup(); s.h.series.status = '已发布';
    const ticket = await s.service.issue(actor, bearer, { ...target, access_mode: 'library', expected_version: 1, window: null }, 'local');
    await s.service.read(actor, bearer, ticket.url.slice('/api/frames/'.length), 'local');
    expect(PermissionService.prototype.assertPublishedCase).toHaveBeenCalledWith(s.h.current, target.case_id, 'resp', 1);
    expect(PermissionService.prototype.assertCaseAssignment).not.toHaveBeenCalled();
  });
  it.each([{ source: 'unapproved' }, { frame_count: 0 }, { status: '已下线' }])('rejects inaccessible series %j', async change => {
    const s = await setup(); Object.assign(s.h.series, change);
    await expect(s.issue()).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.cache.render).not.toHaveBeenCalled();
  });
  it('rejects a stale login and missing rate/ticket configuration before rendering', async () => {
    const s = await setup(); s.h.current.updated_at = new Date('2026-01-02');
    await expect(s.issue()).rejects.toBeInstanceOf(ForbiddenException);
    s.rate.configuration.mockImplementation(() => { throw new ServiceUnavailableException(); });
    await expect(s.issue()).rejects.toBeInstanceOf(ServiceUnavailableException);
    const other = await setup(); vi.stubEnv('FRAME_TOKEN_SECRET', '');
    await expect(other.issue()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it.each([null, [], {}, { ...target, frame_index: -1 }, { ...target, window: { center: 0, width: 0 } }, { ...target, raw: true }, { ...target, expected_version: 1 }])('rejects malformed input before opening a transaction: %j', async input => {
    const s = await setup();
    await expect(s.service.issue(actor, bearer, input, 'local')).rejects.toMatchObject({ status: 400 });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
});
