import { expect, it } from 'vitest';
import { decodeMaskInto, encodeMask } from './rle';
it.each([
  [[0, 0, 0, 0], [4]],
  [[1, 1, 1, 1], [0, 4]],
  [[0, 1, 1, 0], [1, 2, 1]],
  [[1, 0, 0, 1], [0, 1, 2, 1]],
])('encodes canonical background-first runs for %j', (pixels, rle) => {
  const mask = encodeMask(Uint8Array.from(pixels), 2, 2);
  expect(mask).toEqual({ width: 2, height: 2, rle });
  expect([...decodeMaskInto(mask, new Uint8Array(4))]).toEqual(pixels);
});
it('round-trips a 512×512 brush mask with holes and row crossings', () => {
  const pixels = new Uint8Array(512 * 512);
  for (let y = 100; y < 300; y++) pixels.fill(1, y * 512 + 80, y * 512 + 400);
  for (let y = 150; y < 180; y++) pixels.fill(0, y * 512 + 120, y * 512 + 160);
  const mask = encodeMask(pixels, 512, 512);
  expect(decodeMaskInto(mask, new Uint8Array(pixels.length))).toEqual(pixels);
});
it.each([[], [0], [3], [5], [1, 0, 3], [1, -1, 4], [1.5, 2.5], [NaN, 4], [Infinity], [Number.MAX_SAFE_INTEGER, 4]].map(rle => ({ rle })))('rejects malformed runs $rle before changing the target', ({ rle }) => {
  const target = new Uint8Array(4).fill(7);
  expect(() => decodeMaskInto({ width: 2, height: 2, rle }, target)).toThrow();
  expect([...target]).toEqual([7, 7, 7, 7]);
});
it('does not allocate from declared dimensions and rejects non-binary inputs', () => {
  expect(() => decodeMaskInto({ width: 1000000, height: 1000000, rle: [1000000000000] }, new Uint8Array(4))).toThrow('尺寸');
  expect(() => encodeMask(Uint8Array.from([0, 255, 0, 0]), 2, 2)).toThrow('0 或 1');
  expect(() => encodeMask(new Uint8Array(4), 0, 2)).toThrow('尺寸');
  expect(() => encodeMask(new Uint8Array(4), 2.5, 2)).toThrow('尺寸');
  expect(() => encodeMask(new Uint8Array(4), 3, 2)).toThrow('长度');
});
