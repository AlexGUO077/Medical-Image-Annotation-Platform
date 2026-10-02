/** Image coordinates use the original DICOM pixel grid, never CSS pixels. */
export type PixelPoint = readonly [number, number];
export interface ImageDisplayTransform {
  origin: PixelPoint;
  xAxis: PixelPoint;
  yAxis: PixelPoint;
}

function finite(point: PixelPoint): void {
  if (point.length !== 2 || !point.every(Number.isFinite)) throw new Error('坐标必须是有限数值');
}

function determinant(transform: ImageDisplayTransform): number {
  finite(transform.origin); finite(transform.xAxis); finite(transform.yAxis);
  const value = transform.xAxis[0] * transform.yAxis[1] - transform.xAxis[1] * transform.yAxis[0];
  if (!Number.isFinite(value) || value === 0) throw new Error('显示变换不可逆');
  return value;
}

/** Axes are the displayed displacement of one source pixel, including zoom/flip/rotation. */
export function imageToDisplay(point: PixelPoint, transform: ImageDisplayTransform): PixelPoint {
  finite(point); determinant(transform);
  const result: PixelPoint = [
    transform.origin[0] + point[0] * transform.xAxis[0] + point[1] * transform.yAxis[0],
    transform.origin[1] + point[0] * transform.xAxis[1] + point[1] * transform.yAxis[1],
  ];
  finite(result); return result;
}

export function displayToImage(point: PixelPoint, transform: ImageDisplayTransform): PixelPoint {
  finite(point);
  const det = determinant(transform);
  const dx = point[0] - transform.origin[0], dy = point[1] - transform.origin[1];
  const result: PixelPoint = [
    (dx * transform.yAxis[1] - dy * transform.yAxis[0]) / det,
    (dy * transform.xAxis[0] - dx * transform.xAxis[1]) / det,
  ];
  finite(result); return result;
}

/** Preserve subpixel precision and normalize a drag in any direction. */
export function boxFromImagePoints(start: PixelPoint, end: PixelPoint) {
  finite(start); finite(end);
  const w = Math.abs(end[0] - start[0]), h = Math.abs(end[1] - start[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w === 0 || h === 0) throw new Error('矩形必须有面积');
  return { x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), w, h };
}
