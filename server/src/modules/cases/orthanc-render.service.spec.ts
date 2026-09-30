import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthancService, type FrameWindow } from './orthanc.service';

const instance = '11111111-22222222-33333333-44444444-55555555';
beforeEach(() => {
  vi.stubEnv('ORTHANC_USERNAME', 'synthetic-user');
  vi.stubEnv('ORTHANC_PASSWORD', 'synthetic-password');
  vi.stubEnv('ORTHANC_HOST', '127.0.0.1');
  vi.stubEnv('ORTHANC_PORT', '8042');
  vi.stubEnv('ORTHANC_USE_TLS', 'false');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Orthanc internal frame renderer', () => {
  it('requests exactly one rendered PNG with explicit windowing and strips image metadata', async () => {
    const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).withMetadata().png().toBuffer();
    const fetch = vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await new OrthancService().renderInstanceFrame(instance, 3, { center: -600, width: 1500 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`http://127.0.0.1:8042/instances/${instance}/frames/3/rendered?window-center=-600&window-width=1500`,
      expect.objectContaining({ method: 'GET', redirect: 'error', headers: expect.objectContaining({ accept: 'image/png' }) }));
    const metadata = await sharp(result).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 32, height: 24 });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
  });

  it('uses the DICOM default window when no explicit window is supplied', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const fetch = vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch);
    await new OrthancService().renderInstanceFrame(instance, 0);
    expect(fetch.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:8042/instances/${instance}/frames/0/rendered`);
  });

  it.each([
    ['../file', 0, undefined], ['https://other-host/file', 0, undefined],
    [instance, -1, undefined], [instance, 0.5, undefined], [instance, Number.MAX_SAFE_INTEGER + 1, undefined],
    [instance, 0, { center: NaN, width: 1 }], [instance, 0, { center: 0, width: 0 }],
    [instance, 0, { center: 0, width: Infinity }], [instance, 0, null],
  ])('rejects invalid internal render parameters before network I/O', async (id, frame, window) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new OrthancService().renderInstanceFrame(id as string, frame as number, window as FrameWindow | undefined))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response('raw dicom', { headers: { 'content-type': 'application/dicom' } }),
    () => new Response('invalid png', { headers: { 'content-type': 'image/png' } }),
    () => new Response('internal storage detail', { status: 500 }),
    () => { throw new Error('private-host/path'); },
  ])('fails closed with a generic error and never requests a raw fallback', async (response) => {
    const fetch = vi.fn().mockImplementation(response); vi.stubGlobal('fetch', fetch);
    await expect(new OrthancService().renderInstanceFrame(instance, 0)).rejects.toEqual(new ServiceUnavailableException('单帧渲染不可用'));
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('authorized series frame mapping', () => {
  const uid = '2.25.123';
  const other = 'aaaaaaaa-bbbbbbbb-cccccccc-dddddddd-eeeeeeee';
  it('maps a flattened index to the selected instance frame', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ MainDicomTags: { SeriesInstanceUID: uid }, Instances: [instance, other] }))
      .mockResolvedValueOnce(Response.json({ Slices: [`/instances/${instance}/frames/0`, `/instances/${other}/frames/3`] }));
    vi.stubGlobal('fetch', fetch);
    expect(await new OrthancService().resolveSeriesFrame(instance, uid, 1, 2)).toEqual({ instance_id: other, frame_index: 3 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['https://private/raw', `/instances/${other}/frames/0`, `/instances/${instance}/file`, `/instances/${instance}/frames/-1`])('rejects foreign or non-frame mapping %s', slice => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ MainDicomTags: { SeriesInstanceUID: uid }, Instances: [instance] }))
      .mockResolvedValueOnce(Response.json({ Slices: [slice] }));
    vi.stubGlobal('fetch', fetch);
    return expect(new OrthancService().resolveSeriesFrame(instance, uid, 0, 1)).rejects.toThrow('序列帧映射不可用');
  });
  it('rejects a changed frame total', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ MainDicomTags: { SeriesInstanceUID: uid }, Instances: [instance] }))
      .mockResolvedValueOnce(Response.json({ Slices: [] })));
    await expect(new OrthancService().resolveSeriesFrame(instance, uid, 0, 1)).rejects.toThrow('序列帧映射不可用');
  });
});
