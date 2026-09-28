import { BadRequestException, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { MANUAL_QUARANTINE_ROOT } from './cases-import.paths';
import { CasesManualService } from './cases-manual.service';

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001', username: 'synthetic-admin',
  password_hash: 'unused', real_name: '合成管理员', role: 'admin', quals: {},
  status: 'active', expire_at: '2099-12-31', must_change_password: false,
  mfa_secret_encrypted: 'unused', updated_at: new Date('2026-09-24T00:00:00Z'),
};

const createdPaths: string[] = [];

afterEach(async () => {
  for (const path of createdPaths.splice(0)) await rm(path, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function harness() {
  const values = new Map<string, string>();
  const manager = { query: vi.fn().mockResolvedValue([]) };
  const dataSource = {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (callback) => callback(manager)),
  };
  const redis = {
    set: vi.fn().mockImplementation(async (key: string, value: string) => { values.set(key, value); return 'OK'; }),
    get: vi.fn().mockImplementation(async (key: string) => values.get(key) ?? null),
    del: vi.fn().mockImplementation(async (key: string) => { values.delete(key); return 1; }),
    eval: vi.fn().mockResolvedValue(1),
  };
  const worker = {
    processManual: vi.fn().mockImplementation(async (_report: string, _image: string, output: string) => {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, 'masked-report.txt'), 'SYNTHETIC SAFE REPORT');
      await writeFile(join(output, 'mask-map.json'), '[]');
      await writeFile(join(output, 'key-image.png'), await syntheticPng());
      return {
        masked_report: 'SYNTHETIC SAFE REPORT', masked_count: 1,
        image_redaction_count: 0, masked_report_path: join(output, 'masked-report.txt'),
        mask_map_path: join(output, 'mask-map.json'), image_path: join(output, 'key-image.png'),
      };
    }),
  };
  const maskMaps = { storeFromFile: vi.fn().mockResolvedValue(null), remove: vi.fn().mockResolvedValue(undefined) };
  const objects = {
    storePng: vi.fn().mockResolvedValue(100),
    readPng: vi.fn().mockResolvedValue(Buffer.from('safe-png')),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const instance = new CasesManualService(dataSource as never, redis as never, worker as never, maskMaps as never, objects as never, { reserve: vi.fn().mockResolvedValue("intent"), complete: vi.fn(), compensate: vi.fn(async () => { await objects.remove("reserved"); await maskMaps.remove("00000000-0000-4000-8000-000000000099"); }) } as never);
  return { instance, dataSource, manager, redis, worker, maskMaps, objects, values };
}

async function syntheticPng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } }).png().toBuffer();
}

async function upload() {
  await mkdir(MANUAL_QUARANTINE_ROOT, { recursive: true });
  const filename = '10000000-0000-4000-8000-000000000001.upload';
  const path = join(MANUAL_QUARANTINE_ROOT, filename);
  createdPaths.push(path);
  await writeFile(path, await syntheticPng());
  return { path, filename, originalname: 'neutral.png', mimetype: 'image/png' } as Express.Multer.File;
}

describe('CasesManualService', () => {
  it('rejects unapproved sources and removes the uploaded file', async () => {
    const { instance } = harness();
    const file = await upload();
    await expect(instance.prepare(admin, file, 'unapproved', 'SYNTHETIC REPORT')).rejects.toBeInstanceOf(BadRequestException);
    await expect(writeFile(file.path, 'cleaned', { flag: 'wx' })).resolves.toBeUndefined();
  });

  it('rejects a declared JPG whose decoded content is PNG', async () => {
    const { instance, worker } = harness();
    const file = await upload();
    file.originalname = 'neutral.jpg';
    file.mimetype = 'image/jpeg';
    await expect(instance.prepare(admin, file, 'synthetic', 'SYNTHETIC REPORT'))
      .rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(worker.processManual).not.toHaveBeenCalled();
  });

  it('keeps raw input out of Redis and commits only a masked report and PNG attachment', async () => {
    const { instance, values, manager, objects } = harness();
    const file = await upload();
    const prepared = await instance.prepare(admin, file, 'synthetic', 'SYNTHETIC INPUT');
    createdPaths.push(join(MANUAL_QUARANTINE_ROOT, prepared.draft_id));
    expect(prepared).toMatchObject({ masked_report: 'SYNTHETIC SAFE REPORT', masked_count: 1 });
    expect(JSON.stringify([...values.values()])).not.toContain('SYNTHETIC INPUT');
    expect(JSON.stringify([...values.values()])).not.toContain(file.originalname);

    const confirmed = await instance.confirm(prepared.draft_id, admin, {
      confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断',
    }, '127.0.0.1');
    expect(confirmed).toMatchObject({ status: '已录入' });
    const queries = manager.query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(queries).toContain('INSERT INTO "cases"');
    expect(queries).toContain('INSERT INTO "reports"');
    expect(queries).toContain('INSERT INTO "attachments"');
    expect(queries).not.toMatch(/INSERT INTO "(?:studies|series)"/);
    expect(objects.storePng).toHaveBeenCalledOnce();
  });

  it('does not disclose another administrator’s draft', async () => {
    const { instance } = harness();
    const file = await upload();
    const prepared = await instance.prepare(admin, file, 'synthetic', 'SYNTHETIC INPUT');
    createdPaths.push(join(MANUAL_QUARANTINE_ROOT, prepared.draft_id));
    await expect(instance.preview(prepared.draft_id, { ...admin, id: '00000000-0000-4000-8000-000000000002' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects cross-account confirmation before writing formal objects', async () => {
    const { instance, objects } = harness();
    const file = await upload();
    const prepared = await instance.prepare(admin, file, 'synthetic', 'SYNTHETIC INPUT');
    createdPaths.push(join(MANUAL_QUARANTINE_ROOT, prepared.draft_id));
    await expect(instance.confirm(prepared.draft_id, {
      ...admin, id: '00000000-0000-4000-8000-000000000002',
    }, { confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(objects.storePng).not.toHaveBeenCalled();
  });

  it('cleans quarantine when deidentification fails', async () => {
    const { instance, redis, worker } = harness();
    worker.processManual.mockRejectedValueOnce(new Error('worker unavailable'));
    const file = await upload();
    await expect(instance.prepare(admin, file, 'synthetic', 'SYNTHETIC INPUT')).rejects.toThrow('worker unavailable');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('compensates the object and mapping if the database transaction fails', async () => {
    const { instance, dataSource, objects, maskMaps } = harness();
    const file = await upload();
    const prepared = await instance.prepare(admin, file, 'synthetic', 'SYNTHETIC INPUT');
    createdPaths.push(join(MANUAL_QUARANTINE_ROOT, prepared.draft_id));
    maskMaps.storeFromFile.mockResolvedValueOnce('00000000-0000-4000-8000-000000000099');
    dataSource.transaction.mockRejectedValueOnce(new Error('synthetic database failure'));

    await expect(instance.confirm(prepared.draft_id, admin, {
      confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断',
    }, '127.0.0.1')).rejects.toThrow('synthetic database failure');
    expect(objects.remove).toHaveBeenCalledOnce();
    expect(maskMaps.remove).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000099');
  });

  it('returns an already committed case for an uncertain confirmation retry', async () => {
    const { instance, dataSource, objects } = harness();
    dataSource.query.mockResolvedValueOnce([{ id: '00000000-0000-4000-8000-000000000090', case_no: 'SYN-RETRY' }]);

    const response = await instance.confirm('00000000-0000-4000-8000-000000000011', admin, {
      confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断',
    }, '127.0.0.1');

    expect(response).toEqual({ case_id: '00000000-0000-4000-8000-000000000090', case_no: 'SYN-RETRY', status: '已录入' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(objects.storePng).not.toHaveBeenCalled();
  });
});
