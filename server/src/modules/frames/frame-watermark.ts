import sharp from 'sharp';
import type { AuthUser } from '../auth/auth.models';

export async function watermarkFrame(bytes: Buffer, actor: Pick<AuthUser, 'username' | 'real_name'>): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(bytes, { limitInputPixels: 50_000_000 }).metadata();
  const w = Math.min(width, 520), h = Math.min(height, 140);
  const labels = [actor.username, actor.real_name, new Date().toISOString()];
  // Do not depend on SVG textLength (not supported consistently by libvips/librsvg).
  // Three bounded rows keep the timestamp visible even for a long account name.
  const text = labels.map((label, index) => {
    const escaped = label.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
    const size = Math.min(18, h / 5, Math.max(1, w - 8) / Math.max(1, [...label].length * 1.1));
    return `<text x="${Math.min(4, w / 8)}" y="${h * (index + 1) / 4}" font-size="${size}" fill="white" fill-opacity="0.12" stroke="black" stroke-opacity="0.12" stroke-width="0.5" paint-order="stroke">${escaped}</text>`;
  }).join('');
  return sharp(bytes, { limitInputPixels: 50_000_000 }).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}">${text}</svg>`), tile: true }]).png().toBuffer();
}
