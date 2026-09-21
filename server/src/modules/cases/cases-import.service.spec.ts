import { BadRequestException } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import type { ImportBatch } from './cases-import.models';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { CasesImportService } from './cases-import.service';

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  password_hash: 'unused',
  real_name: '合成管理员',
  role: 'admin',
  quals: {},
  status: 'active',
  expire_at: '2099-12-31',
  must_change_password: false,
  mfa_secret_encrypted: 'encrypted',
  updated_at: new Date('2026-09-21T00:00:00Z'),
};

function service(overrides: Record<string, unknown> = {}) {
  const dataSource = { query: vi.fn(), transaction: vi.fn() };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const store = {
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    save: vi.fn(),
    refreshStatus: vi.fn(),
    progress: vi.fn(),
    dequeue: vi.fn(),
    acknowledge: vi.fn(),
    retry: vi.fn(),
    recoverInterrupted: vi.fn(),
  };
  const worker = { inspectZip: vi.fn(), processCase: vi.fn() };
  const maskMaps = { storeFromFile: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const orthanc = { uploadSeries: vi.fn(), removeSeries: vi.fn() };
  const dependencies = { dataSource, audit, store, worker, maskMaps, orthanc };
  Object.assign(dependencies, overrides);
  return {
    instance: new CasesImportService(
      dependencies.dataSource as never,
      dependencies.audit as never,
      dependencies.store as never,
      dependencies.worker as never,
      dependencies.maskMaps as never,
      dependencies.orthanc as never,
    ),
    ...dependencies,
  };
}

describe('CasesImportService', () => {
  it('rejects any source outside the approved synthetic D-31 boundary', async () => {
    const { instance } = service();
    const uploadName = '10000000-0000-4000-8000-000000000001.zip';
    const upload = join(IMPORT_QUARANTINE_ROOT, uploadName);
    await mkdir(IMPORT_QUARANTINE_ROOT, { recursive: true });
    await rm(upload, { force: true });
    await writeFile(upload, Buffer.from('504b030400000000', 'hex'));
    try {
      await expect(instance.acceptUpload(admin, { path: upload, filename: uploadName } as Express.Multer.File, 'hospital-a', '127.0.0.1'))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(writeFile(upload, 'cleaned', { flag: 'wx' })).resolves.toBeUndefined();
    } finally {
      await rm(upload, { force: true });
    }
  });

  it('persists a derived source record and audits the accepted batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miap-import-test-'));
    const uploadName = '10000000-0000-4000-8000-000000000002.zip';
    const upload = join(IMPORT_QUARANTINE_ROOT, uploadName);
    await mkdir(IMPORT_QUARANTINE_ROOT, { recursive: true });
    await rm(upload, { force: true });
    await writeFile(upload, Buffer.from('504b030400000000', 'hex'));
    const { instance, audit, store, worker } = service();
    worker.inspectZip.mockResolvedValue({
      compressed_size: 8,
      expanded_size: 10,
      file_count: 1,
      items: [{ display_name: 'case-001', path: join(root, 'case-001') }],
    });
    try {
      const result = await instance.acceptUpload(admin, {
        path: upload,
        filename: uploadName,
        originalname: 'synthetic.zip',
      } as Express.Multer.File, 'synthetic', '127.0.0.1');

      const batch = store.create.mock.calls[0]?.[0] as ImportBatch;
      expect(result).toMatchObject({ source: 'synthetic', source_record: { decision: 'D-31', real_data_allowed: false } });
      expect(batch.source_record).toMatchObject({
        source: 'synthetic',
        scope: 'development_test_only',
        real_data_allowed: false,
        decision: 'D-31',
        recorded_by: admin.id,
      });
      expect(batch.items[0]?.status).toBe('queued');
      expect(audit.record).toHaveBeenCalledWith(
        admin.id,
        'case_import.batch_accepted',
        expect.stringMatching(/^import_batch:/),
        expect.objectContaining({ source: 'synthetic', scope: 'development_test_only' }),
        '127.0.0.1',
      );
      expect(store.enqueue).toHaveBeenCalledTimes(1);
    } finally {
      const createdBatch = store.create.mock.calls[0]?.[0] as ImportBatch | undefined;
      if (createdBatch) await rm(createdBatch.quarantine_path, { recursive: true, force: true });
      await rm(upload, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires explicit system and confirmation method when confirming import', async () => {
    const { instance } = service();
    await expect(instance.confirm(
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000011',
      admin,
      { confirmed: true, system_code: 'resp' },
      '127.0.0.1',
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not remove committed formal data when quarantine auditing fails', async () => {
    const batchId = '00000000-0000-4000-8000-000000000010';
    const itemId = '00000000-0000-4000-8000-000000000011';
    const batch: ImportBatch = {
      batch_id: batchId,
      source: 'synthetic',
      source_record: {
        source: 'synthetic',
        scope: 'development_test_only',
        real_data_allowed: false,
        decision: 'D-31',
        recorded_by: admin.id,
        recorded_at: '2026-09-21T00:00:00.000Z',
      },
      actor_id: admin.id,
      request_ip: '127.0.0.1',
      quarantine_path: join(tmpdir(), 'missing-import-batch'),
      status: 'awaiting_confirmation',
      stage: 'manual_confirmation',
      created_at: '2026-09-21T00:00:00.000Z',
      updated_at: '2026-09-21T00:00:00.000Z',
      items: [{
        item_id: itemId,
        display_name: 'case-001',
        quarantine_path: join(tmpdir(), 'missing-import-batch', 'case-001'),
        status: 'awaiting_confirmation',
        stage: 'manual_confirmation',
        failure: null,
        review: {
          masked_report: null,
          masked_count: 0,
          ocr_hits: [],
          ocr_failed: false,
          suggested_system_code: 'resp',
          classification_confidence: 1,
        },
        processed: {
          study_uid: '2.25.1',
          study_date: '20260921',
          series: [{
            modality: 'CT',
            series_uid: '2.25.2',
            frame_count: 1,
            default_window: { center: 40, width: 400 },
            dicom_paths: ['/tmp/synthetic.dcm'],
          }],
          masked_report_path: null,
          mask_map_path: null,
          preview_path: '/tmp/synthetic.png',
        },
        case_id: null,
      }],
    };
    const { instance, dataSource, audit, store, maskMaps, orthanc } = service();
    dataSource.query.mockResolvedValue([]);
    dataSource.transaction.mockResolvedValue('00000000-0000-4000-8000-000000000012');
    store.get.mockResolvedValue(batch);
    store.save.mockResolvedValue(undefined);
    orthanc.uploadSeries.mockResolvedValue({ id: 'orthanc-series', created: true });
    orthanc.removeSeries.mockResolvedValue(undefined);
    maskMaps.storeFromFile.mockResolvedValue('mask-map');
    maskMaps.remove.mockResolvedValue(undefined);
    audit.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(instance.confirm(
      batchId,
      itemId,
      admin,
      { confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' },
      '127.0.0.1',
    )).rejects.toThrow('audit unavailable');

    expect(store.save).toHaveBeenCalled();
    expect(batch.items[0]).toMatchObject({ status: 'completed', case_id: '00000000-0000-4000-8000-000000000012' });
    expect(orthanc.removeSeries).not.toHaveBeenCalled();
    expect(maskMaps.remove).not.toHaveBeenCalled();
  });
});
