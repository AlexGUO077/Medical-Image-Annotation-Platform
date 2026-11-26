import type { Annotation, PointGeometry } from './types';

export function pointsOnFrame(object: Annotation, frame: number) {
  const { x, y, additional_points: extra = [] } = object.geometry as PointGeometry;
  const marks = extra.flatMap((point, i) => point.frame_index === frame ? [{ x: point.x, y: point.y, index: i + 1 }] : []);
  if (frame === object.key_frame_index || (!extra.length && frame >= object.frame_start && frame <= object.frame_end)) {
    marks.unshift({ x, y, index: 0 });
  }
  return marks;
}

export function movePoint(object: Annotation, index: number, x: number, y: number): PointGeometry {
  const geometry = object.geometry as PointGeometry;
  if (index === 0) return { ...geometry, x, y };
  return { ...geometry, additional_points: geometry.additional_points?.map((point, i) => i + 1 === index ? { ...point, x, y } : point) };
}

export function pointFrames(object: Annotation): number[] {
  const extra = (object.geometry as PointGeometry).additional_points ?? [];
  return [...new Set([object.key_frame_index, ...extra.map(point => point.frame_index)])];
}
