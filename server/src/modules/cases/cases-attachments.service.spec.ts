import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { CasesAttachmentsService } from './cases-attachments.service';
import * as quarantine from './cases-import.paths';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
const caseId = '00000000-0000-4000-8000-000000000001';
const actor = { id: caseId, username: 'synthetic', real_name: '合成' } as never;
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const id of dirs.splice(0)) await rm(join(IMPORT_QUARANTINE_ROOT, 'attachments', id), { recursive: true, force: true }); });
function setup() {
  const values = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value, opts) => { if (opts?.NX && values.has(key)) return null; values.set(key, value); return 'OK'; }),
    del: vi.fn(async (key) => values.delete(key)), eval: vi.fn(async (_script, { keys }) => values.delete(keys[0])),
  };
  const query = vi.fn().mockImplementation(async (sql) => sql.includes('audit_logs') ? [] : [{ status: '已录入', source: 'synthetic' }]);
  const manager = { query: vi.fn().mockResolvedValue([{ status: '已录入', source: 'synthetic' }]) };
  const db = { query, transaction: vi.fn(async (fn) => fn(manager)) };
  const worker = { processAttachment: vi.fn(async (_path, output) => {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'page-1.png'), await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer());
    return { page_count: 1 };
  }) };
  const objects = { storePages: vi.fn().mockResolvedValue(100), removePages: vi.fn(), pageCount: vi.fn().mockResolvedValue(2), readPng: vi.fn() };
  return { service: new CasesAttachmentsService(db as never, redis as never, worker as never, objects as never, { reserve: vi.fn().mockResolvedValue("intent"), complete: vi.fn(), compensate: vi.fn(async () => objects.removePages("reserved", 1)) } as never), db, manager, redis, worker, objects, values };
}
function file(bytes = 'png') { return { buffer: Buffer.from(bytes), originalname: 'chunk.png', mimetype: 'image/png' } as Express.Multer.File; }
const first = { part_index: '0', part_count: '2', file_size: '6', format: 'png' };
async function receive(h: ReturnType<typeof setup>, complete = false) {
  const result = await h.service.receive(caseId, actor, complete ? { ...first, part_count: '1', file_size: '3' } : first, file());
  dirs.push(result.upload_id); return result.upload_id;
}
async function ready(h: ReturnType<typeof setup>, id: string) {
  await vi.waitFor(async () => expect((await h.service.progress(caseId, id, actor)).status).toBe('pending_confirmation'));
}
describe('attachment lifecycle', () => {
  it('rejects MIME, size and unsupported formats before accepting bytes', async () => {
    const h = setup();
    for (const body of [{ ...first, format: 'exe' }, { ...first, file_size: String(51 * 1024 * 1024) }, { ...first, part_index: '1' }]) {
      await expect(h.service.receive(caseId, actor, body, file())).rejects.toThrow();
    }
    await expect(h.service.receive(caseId, actor, first, { ...file(), mimetype: 'text/plain' })).rejects.toThrow();
    expect(h.worker.processAttachment).not.toHaveBeenCalled();
  });
  it('rejects duplicate, missing and inconsistent chunks without replacing accepted bytes', async () => {
    const h = setup(), id = await receive(h);
    await expect(h.service.receive(caseId, actor, { ...first, upload_id: id }, file())).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.receive(caseId, actor, { ...first, upload_id: id, part_index: '1', file_size: '7' }, file())).rejects.toBeInstanceOf(ConflictException);
    await h.service.receive(caseId, actor, { ...first, upload_id: id, part_index: '1' }, file());
    await ready(h, id);
    expect(h.worker.processAttachment).toHaveBeenCalledOnce();
    expect(h.objects.storePages).not.toHaveBeenCalled();
  });
  it('binds status, preview, chunks and confirmation to the case and creator', async () => {
    const h = setup(), id = await receive(h), other = { id: randomUUID() } as never;
    await expect(h.service.progress(caseId, id, other)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.progress(randomUUID(), id, actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.uploadPreview(caseId, id, '1', other)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.confirm(caseId, id, other, { confirmed: true, kind: '其他' }, 'local')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.objects.storePages).not.toHaveBeenCalled();
  });
  it('fails closed and clears quarantine when processing fails', async () => {
    const h = setup(); h.worker.processAttachment.mockRejectedValueOnce(new Error('sensitive internal path'));
    const id = await receive(h, true);
    await vi.waitFor(async () => expect((await h.service.progress(caseId, id, actor)).status).toBe('failed'));
    expect(JSON.stringify(await h.service.progress(caseId, id, actor))).not.toContain('sensitive');
    await expect(access(join(IMPORT_QUARANTINE_ROOT, 'attachments', id))).rejects.toThrow();
    await expect(h.service.uploadPreview(caseId, id, '1', actor)).rejects.toThrow();
    expect(h.objects.storePages).not.toHaveBeenCalled();
  });
  it.each(['directory', 'input'])('records failure when the processing %s path is rejected', async (stage) => {
    const h = setup(), original = quarantine.quarantinePath;
    vi.spyOn(quarantine, 'quarantinePath').mockImplementation((...parts) => {
      const processing = [...h.values.entries()].some(([key, value]) =>
        key.startsWith('miap:attachment:') && !key.includes(':lock:') && JSON.parse(value).status === 'processing');
      const inputPath = parts.at(-1) === 'input.png';
      if (processing && inputPath === (stage === 'input')) throw new Error('sensitive quarantine path');
      return original(...parts);
    });
    const id = await receive(h, true);
    await vi.waitFor(async () => expect(await h.service.progress(caseId, id, actor)).toMatchObject({
      status: 'failed', failure_code: 'ATTACHMENT_PROCESSING_FAILED', page_count: 0,
    }));
    expect(JSON.stringify(await h.service.progress(caseId, id, actor))).not.toContain('sensitive');
    expect(h.worker.processAttachment).not.toHaveBeenCalled();
    expect(h.objects.storePages).not.toHaveBeenCalled();
    await expect(h.service.uploadPreview(caseId, id, '1', actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.confirm(caseId, id, actor, { confirmed: true, kind: '其他' }, 'local')).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires explicit review, verifies page bounds and removes formal objects on DB failure', async () => {
    const h = setup(), id = await receive(h, true); await ready(h, id);
    await expect(h.service.confirm(caseId, id, actor, { confirmed: false, kind: '其他' }, 'local')).rejects.toThrow();
    await expect(h.service.uploadPreview(caseId, id, '2', actor)).rejects.toBeInstanceOf(NotFoundException);
    const png = await h.service.uploadPreview(caseId, id, '1', actor);
    expect((await sharp(png).metadata()).format).toBe('png');
    h.db.transaction.mockRejectedValueOnce(new Error('DB failed'));
    await expect(h.service.confirm(caseId, id, actor, { confirmed: true, kind: '其他' }, 'local')).rejects.toThrow('DB failed');
    expect(h.objects.removePages).toHaveBeenCalledOnce();
    expect((await h.service.progress(caseId, id, actor)).status).toBe('pending_confirmation');
  });
  it('commits attachment and audit atomically then removes temporary data', async () => {
    const h = setup(), id = await receive(h, true); await ready(h, id);
    const result = await h.service.confirm(caseId, id, actor, { confirmed: true, kind: '病理' }, 'local');
    expect(result).toMatchObject({ deid_confirmed: true, size: '100' });
    expect(h.manager.query.mock.calls.map((c) => c[0]).join(' ')).toContain('INSERT INTO "audit_logs"');
    await expect(h.service.progress(caseId, id, actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(access(join(IMPORT_QUARANTINE_ROOT, 'attachments', id))).rejects.toThrow();
  });
  it('rejects expired upload sessions', async () => {
    const h = setup(), id = await receive(h);
    const key = `miap:attachment:${id}`;
    h.values.set(key, JSON.stringify({ ...JSON.parse(h.values.get(key)!), expires_at: Date.now() - 1 }));
    await expect(h.service.progress(caseId, id, actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});
