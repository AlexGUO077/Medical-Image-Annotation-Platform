import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesImportApi } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('casesImportApi', () => {
  it('uploads multipart data without overriding the browser boundary header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      batch_id: 'batch-1', status: 'queued', source: 'teacher_provided_teaching',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await casesImportApi.create(
      'token-1',
      'teacher_provided_teaching',
      new File(['zip'], 'cases.zip', { type: 'application/zip' }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1' });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('source')).toBe('teacher_provided_teaching');
    expect(((init.body as FormData).get('file') as File).name).toBe('import.zip');
  });

  it('rejects non-image preview responses without exposing their body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>failure</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })));

    await expect(casesImportApi.preview('token', 'batch', 'item')).rejects.toThrow('脱敏预览加载失败');
  });

  it('reads progress and submits the explicit confirmation contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batch_id: 'batch-1', source: 'synthetic', status: 'awaiting_confirmation', stage: 'manual_confirmation',
        counts: { total: 1, queued: 0, processing: 0, awaiting_confirmation: 1, completed: 0, duplicate: 0, failed: 0 },
        items: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        batch_id: 'batch-1', item_id: 'item-1', case_id: 'case-1', status: 'completed', case_status: '已录入',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await casesImportApi.progress('token', 'batch-1');
    await casesImportApi.confirm('token', 'batch-1', 'item-1', {
      confirmed: true,
      system_code: 'resp',
      confirm_method: '临床综合诊断',
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/cases/import/batch-1/items/item-1/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmed: true, system_code: 'resp', confirm_method: '临床综合诊断' }),
      }),
    );
  });
});
