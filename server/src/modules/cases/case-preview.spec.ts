import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { watermarkPreview } from './case-preview';
describe('account watermarks', () => {
  it.each(['white', 'black'])('changes pixels on a %s background without metadata', async (background) => {
    const source = await sharp({ create: { width: 520, height: 180, channels: 3, background } }).png().toBuffer();
    const output = await watermarkPreview(source, { username: 'synthetic', real_name: '测试' } as never);
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    expect(pixels.equals(await sharp(source).raw().toBuffer())).toBe(false);
    expect((await sharp(output).metadata()).exif).toBeUndefined();
  });
  it('does not fall back to original bytes for a small image', async () => {
    const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer();
    expect((await sharp(await watermarkPreview(source, { username: 'x', real_name: 'y' } as never)).metadata()).width).toBe(16);
  });
});
