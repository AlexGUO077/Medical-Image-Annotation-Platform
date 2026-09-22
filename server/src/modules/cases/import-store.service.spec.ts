import { describe, expect, it } from 'vitest';
import type { ImportBatch } from './cases-import.models';
import { ImportStoreService } from './import-store.service';

const batch: ImportBatch = {
  batch_id: '00000000-0000-4000-8000-000000000010',
  source: 'synthetic',
  source_record: {
    source: 'synthetic', scope: 'development_test_only', real_data_allowed: false,
    authorization_basis: 'synthetic_data', valid_until: 'project_acceptance',
    withdrawal_action: 'stop_import_and_delete',
    decision: 'D-31', recorded_by: 'admin', recorded_at: '2026-09-21T00:00:00Z',
  },
  actor_id: 'admin',
  request_ip: '127.0.0.1',
  quarantine_path: '/tmp/synthetic',
  status: 'processing',
  stage: 'deidentification',
  created_at: '2026-09-21T00:00:00Z',
  updated_at: '2026-09-21T00:00:00Z',
  items: [
    {
      item_id: 'one', display_name: 'one', quarantine_path: '/tmp/one', status: 'awaiting_confirmation',
      stage: 'manual_confirmation', failure: null, review: null, processed: null, case_id: null,
    },
    {
      item_id: 'two', display_name: 'two', quarantine_path: '/tmp/two', status: 'failed',
      stage: 'failed', failure: { code: 'DICOM_INVALID', message: 'DICOM 文件无法解析' },
      review: null, processed: null, case_id: null,
    },
  ],
};

describe('ImportStoreService', () => {
  it('reports per-item progress without exposing quarantine or processed paths', () => {
    const store = new ImportStoreService({} as never);
    const progress = store.progress(structuredClone(batch));
    expect(progress.counts).toMatchObject({ total: 2, awaiting_confirmation: 1, failed: 1 });
    expect(progress.items[0]).not.toHaveProperty('quarantine_path');
    expect(progress.items[0]).not.toHaveProperty('processed');
  });

  it('does not mark a mixed batch complete while confirmation is pending', () => {
    const store = new ImportStoreService({} as never);
    const value = structuredClone(batch);
    store.refreshStatus(value);
    expect(value.status).toBe('awaiting_confirmation');
  });
});
