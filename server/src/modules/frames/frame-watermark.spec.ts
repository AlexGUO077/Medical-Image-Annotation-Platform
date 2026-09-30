import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { watermarkFrame } from './frame-watermark';
afterEach(() => vi.useRealTimers());
describe('frame response watermark', () => {
  it('keeps account, name and changing response time visible with a long username', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T00:00:00.000Z'));
    const source = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#808080' } }).png().toBuffer();
    const actor = { username: 'synthetic-account-with-a-long-name-123456', real_name: '合成<&验证' };
    const first = await watermarkFrame(source, actor);
    vi.setSystemTime(new Date('2026-09-30T01:02:03.456Z'));
    expect((await watermarkFrame(source, actor)).equals(first)).toBe(false);
    expect((await watermarkFrame(source, { ...actor, real_name: '其他姓名' })).equals(first)).toBe(false);
    expect((await sharp(first).metadata()).exif).toBeUndefined();
    expect(first.equals(source)).toBe(false);
  });
});
