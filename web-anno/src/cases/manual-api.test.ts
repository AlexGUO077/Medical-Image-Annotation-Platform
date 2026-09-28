import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesManualApi } from './manual-api';

afterEach(() => vi.restoreAllMocks());

describe('casesManualApi', () => {
  it('uses a neutral upload filename and never sends the original name', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      draft_id: 'draft-id', masked_report: '某', masked_count: 1, image_redaction_count: 0,
      expires_at: '2026-09-25T00:00:00Z',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const file = new File(['image-bytes'], 'patient-name.jpg', { type: 'image/jpeg' });

    await casesManualApi.prepare('token', 'synthetic', '患者：张三', file);

    const options = request.mock.calls[0]?.[1];
    const body = options?.body as FormData;
    const image = body.get('image') as File;
    expect(image.name).toBe('key-image.jpg');
    expect(body.get('source')).toBe('synthetic');
    expect(JSON.stringify([...body.entries()])).not.toContain('patient-name.jpg');
  });

  it('fails closed on a non-PNG preview', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('raw-image', {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    }));
    await expect(casesManualApi.preview('token', 'draft-id')).rejects.toThrow('脱敏关键影像预览失败');
  });
});
