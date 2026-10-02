import { expect, it } from 'vitest';
import { boxFromImagePoints, displayToImage, imageToDisplay, type ImageDisplayTransform, type PixelPoint } from './coordinates';
it('keeps original image coordinates unchanged through zoom and pan', () => {
  const stored: PixelPoint = Object.freeze([120.25, 80.5]);
  const before: ImageDisplayTransform = { origin: [40, 20], xAxis: [2, 0], yAxis: [0, 2] };
  const after: ImageDisplayTransform = { origin: [-300, 100], xAxis: [4, 0], yAxis: [0, 4] };
  expect(imageToDisplay(stored, before)).toEqual([280.5, 181]);
  expect(imageToDisplay(stored, after)).toEqual([181, 422]);
  expect(displayToImage([181, 422], after)).toEqual(stored);
  expect(stored).toEqual([120.25, 80.5]);
});
it('inverts rotated, flipped and unequal axis scales without rounding', () => {
  const transform: ImageDisplayTransform = { origin: [300, 100], xAxis: [0, -2], yAxis: [-3, 0] };
  expect(imageToDisplay([12.5, 20.25], transform)).toEqual([239.25, 75]);
  expect(displayToImage([239.25, 75], transform)).toEqual([12.5, 20.25]);
});
it('normalizes reverse drag after converting screen points to the image grid', () => {
  const transform: ImageDisplayTransform = { origin: [100, 50], xAxis: [2, 0], yAxis: [0, 2] };
  expect(boxFromImagePoints(displayToImage([180, 110], transform), displayToImage([120, 70], transform))).toEqual({ x: 10, y: 10, w: 30, h: 20 });
});
it('rejects singular transforms, non-finite coordinates and zero-area boxes', () => {
  const singular = { origin: [0, 0], xAxis: [1, 2], yAxis: [2, 4] } as const;
  expect(() => displayToImage([1, 2], singular)).toThrow('不可逆');
  expect(() => imageToDisplay([NaN, 2], singular)).toThrow('有限');
  expect(() => boxFromImagePoints([0, 0], [1, 0])).toThrow('面积');
  expect(() => boxFromImagePoints([Infinity, 0], [1, 2])).toThrow('有限');
});
