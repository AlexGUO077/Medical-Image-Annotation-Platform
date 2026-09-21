import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrthancService } from './orthanc.service';

describe('OrthancService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORTHANC_USERNAME;
    delete process.env.ORTHANC_PASSWORD;
  });

  it('does not delete an already stored series when a later upload fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miap-orthanc-test-'));
    const first = join(root, 'first.dcm');
    const second = join(root, 'second.dcm');
    await Promise.all([writeFile(first, 'one'), writeFile(second, 'two')]);
    process.env.ORTHANC_USERNAME = 'synthetic-user';
    process.env.ORTHANC_PASSWORD = 'synthetic-password';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ ParentSeries: 'existing-series', Status: 'AlreadyStored' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const service = new OrthancService();
    const remove = vi.spyOn(service, 'removeSeries').mockResolvedValue(undefined);

    try {
      await expect(service.uploadSeries([first, second])).rejects.toThrow('Orthanc 不可用');
      expect(remove).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
