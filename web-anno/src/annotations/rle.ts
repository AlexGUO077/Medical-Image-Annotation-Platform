/** Binary row-major runs, starting with the background (0) run. Not image pixel data. */
export interface RleMask { width: number; height: number; rle: readonly number[] }
function pixelCount(width: number, height: number): number {
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(count)) {
    throw new Error('掩膜尺寸无效');
  }
  return count;
}

export function encodeMask(pixels: Uint8Array, width: number, height: number): RleMask {
  if (pixelCount(width, height) !== pixels.length) throw new Error('掩膜长度与尺寸不符');
  const rle: number[] = [];
  let value = 0, count = 0;
  for (const pixel of pixels) {
    if (pixel !== 0 && pixel !== 1) throw new Error('掩膜只允许 0 或 1');
    if (pixel === value) count++;
    else { rle.push(count); value = pixel; count = 1; }
  }
  rle.push(count);
  return { width, height, rle };
}

/** Validate the entire input before touching a caller-owned, correctly sized buffer.
 * The caller allocates from trusted image dimensions; encoded dimensions never cause allocation.
 */
export function decodeMaskInto(mask: RleMask, target: Uint8Array): Uint8Array {
  const count = pixelCount(mask.width, mask.height);
  if (count !== target.length) throw new Error('掩膜长度与尺寸不符');
  if (!Array.isArray(mask.rle) || !mask.rle.length) throw new Error('RLE 不能为空');
  let total = 0;
  for (let i = 0; i < mask.rle.length; i++) {
    const run = mask.rle[i];
    if (!Number.isSafeInteger(run) || run < 0 || (i > 0 && run === 0) || run > count - total) throw new Error('RLE 行程无效');
    total += run;
  }
  if (total !== count) throw new Error('RLE 未覆盖完整掩膜');
  let offset = 0;
  mask.rle.forEach((run, i) => { target.fill(i % 2, offset, offset + run); offset += run; });
  return target;
}
