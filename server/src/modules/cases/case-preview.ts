import sharp from 'sharp';
import type { AuthUser } from '../auth/auth.models';

export async function watermarkPreview(image: Buffer, actor: AuthUser): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(image, { limitInputPixels: 50_000_000 }).metadata();
  // The overlay must fit small images too; never return the unwatermarked source on failure.
  const w = Math.min(width, 520);
  const h = Math.min(height, 180);
  const label = `${actor.username} ${actor.real_name} ${new Date().toISOString()}`;
  const escaped = label.replace(/[&<>"']/g, (value) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[value]!);
  const overlay = Buffer.from(`<svg width="${w}" height="${h}"><text x="2" y="${h / 2}" fill="white" fill-opacity="0.12" stroke="black" stroke-opacity="0.12" stroke-width="0.7" paint-order="stroke" font-size="${Math.min(22, h / 3)}" textLength="${Math.max(1, w - 4)}" lengthAdjust="spacingAndGlyphs">${escaped}</text></svg>`);
  return sharp(image, { limitInputPixels: 50_000_000 }).composite([{ input: overlay, tile: true }]).png().toBuffer();
}
