import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseEditApi, casesDetailApi } from './detail-api';
afterEach(() => vi.unstubAllGlobals());
describe('case detail and attachment transport', () => {
  it('sends ordered 5 MB chunks with neutral names, ownership token and consistent metadata', async () => {
    const forms: FormData[] = [];
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toEqual({ Authorization: 'Bearer token' });
      forms.push(options.body as FormData);
      return new Response(JSON.stringify({ upload_id: 'upload-1', next_part_index: forms.length }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'patient-private.pdf', { type: 'application/pdf' });
    const progress = vi.fn();
    expect(await caseEditApi.upload('token', 'case-1', file, progress)).toBe('upload-1');
    expect(forms).toHaveLength(2);
    expect((forms[0]!.get('chunk') as File).name).toBe('chunk.pdf');
    expect(forms[0]!.get('upload_id')).toBeNull();
    expect(forms[1]!.get('upload_id')).toBe('upload-1');
    expect(forms[1]!.get('part_index')).toBe('1');
    expect(forms[1]!.get('file_size')).toBe(String(file.size));
    expect(progress.mock.calls).toEqual([[5 * 1024 * 1024], [file.size]]);
  });
  it('rejects unsafe/oversized attachments before network access', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(caseEditApi.upload('token', 'case', new File(['x'], 'file.exe'), vi.fn())).rejects.toThrow();
    await expect(caseEditApi.upload('token', 'case', new File(['x'], 'file.png', { type: 'text/plain' }), vi.fn())).rejects.toThrow();
    const large = new File(['x'], 'file.pdf'); Object.defineProperty(large, 'size', { value: 50 * 1024 * 1024 + 1 });
    await expect(caseEditApi.upload('token', 'case', large, vi.fn())).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not fall back to original attachments when a preview is not PNG', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('raw', { headers: { 'Content-Type': 'application/pdf' } })));
    await expect(caseEditApi.preview('token', 'case', 'attachment', 1, false)).rejects.toThrow();
  });
  it('handles absent optional reports but surfaces authorization failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('{"message":"无权限"}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await casesDetailApi.report('token', 'case')).toEqual({ masked_report: '', sentences: [] });
    await expect(casesDetailApi.report('token', 'case')).rejects.toThrow('无权限');
  });
});
