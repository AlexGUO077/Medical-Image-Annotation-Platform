import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { RedisClientType } from 'redis';
import { OrthancService } from '../cases/orthanc.service';
import { FrameRenderCacheService, type FrameRenderSource } from './frame-render-cache.service';

const source: FrameRenderSource = { case_id: 'synthetic-case', series_uid: '2.25.12345',
  instance_id: '11111111-22222222-33333333-44444444-55555555', frame_index: 0,
  window: { center: 128, width: 256 } };
async function setup() {
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer();
  const values = new Map<string, Buffer>();
  const get = vi.fn(async (key: string) => values.get(key) ?? null);
  const set = vi.fn(async (key: string, bytes: Buffer, _options: unknown) => { values.set(key, bytes); return 'OK'; });
  const redis = { withTypeMapping: () => ({ get }), set };
  const orthanc = { renderInstanceFrame: vi.fn(async () => png) };
  return { png, values, get, set, orthanc, service: new FrameRenderCacheService(redis as unknown as RedisClientType, orthanc as unknown as OrthancService) };
}

describe('internal rendered frame cache', () => {
  it('stores PNG for 1800 seconds and reuses hits without refreshing expiry', async () => {
    const { service, set, orthanc, png } = await setup();
    expect(await service.render(source)).toEqual(png);
    expect(await service.render(source)).toEqual(png);
    expect(orthanc.renderInstanceFrame).toHaveBeenCalledExactlyOnceWith(source.instance_id, 0, source.window);
    expect(set).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^frames:render:v1:[a-f0-9]{64}$/), png, { EX: 1800 });
  });

  it.each([{ case_id: 'another-case' }, { series_uid: '2.25.456' },
    { instance_id: '22222222-22222222-33333333-44444444-55555555' }, { frame_index: 1 },
    { window: { center: 129, width: 256 } }, { window: { center: 128, width: 257 } }, { window: null },
  ])('isolates different render sources %j', async change => {
    const { service, orthanc, values } = await setup();
    await service.render(source); await service.render({ ...source, ...change });
    expect(orthanc.renderInstanceFrame).toHaveBeenCalledTimes(2); expect(values.size).toBe(2);
  });

  it('re-renders corrupted cache instead of serving it', async () => {
    const { service, values, orthanc, png } = await setup();
    await service.render(source);
    for (const key of values.keys()) values.set(key, Buffer.from('not a PNG'));
    expect(await service.render(source)).toEqual(png);
    expect(orthanc.renderInstanceFrame).toHaveBeenCalledTimes(2);
  });

  it('does not cache invalid upstream bytes', async () => {
    const { service, set, orthanc } = await setup();
    orthanc.renderInstanceFrame.mockResolvedValue(Buffer.from('raw dicom'));
    await expect(service.render(source)).rejects.toThrow('帧渲染缓存不可用'); expect(set).not.toHaveBeenCalled();
  });

  it('fails closed on Redis read/write errors without exposing connection details', async () => {
    const { service, get, set, orthanc } = await setup();
    get.mockRejectedValueOnce(new Error('private redis endpoint'));
    await expect(service.render(source)).rejects.toThrow('帧渲染缓存不可用'); expect(orthanc.renderInstanceFrame).not.toHaveBeenCalled();
    set.mockRejectedValueOnce(new Error('private redis endpoint'));
    await expect(service.render(source)).rejects.toThrow('帧渲染缓存不可用');
  });
});
