import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export const REPORT_NOT_MENTIONED = -1;
export type AnnotationTool = 'box' | 'point' | 'polygon' | 'brush';
export interface AnnotationInput {
  id: string; series_id: string; tool: AnnotationTool; geometry: Record<string, unknown>;
  frame_start: number; frame_end: number; key_frame_index: number;
  window_preset: string | null; part_id: string | null; sign_tag_ids: string[];
  confidence: '典型' | '不典型' | null; report_sent_ids: number[];
}
function invalid(message: string): never { throw new BadRequestException(message); }
export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid('标注字段无效');
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid('标注标识无效');
  return value.toLowerCase();
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) invalid('标注整数无效');
  return value;
}
function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid('标注坐标无效');
  return value;
}
function mask(value: unknown) {
  const item = object(value, ['rle', 'width', 'height']);
  const width = integer(item.width), height = integer(item.height), count = width * height;
  if (!width || !height || !Number.isSafeInteger(count) || !Array.isArray(item.rle) || !item.rle.length) invalid('掩膜尺寸或 RLE 无效');
  let total = 0;
  const rle = item.rle.map((run, i) => {
    if (typeof run !== 'number' || !Number.isSafeInteger(run) || run < 0 || (i > 0 && run === 0) || run > count - total) invalid('RLE 行程无效');
    total += run; return run;
  });
  if (total !== count) invalid('RLE 未覆盖完整掩膜');
  return { rle, width, height };
}
function geometry(tool: AnnotationTool, value: unknown, start: number, end: number, key: number): Record<string, unknown> {
  const keys = tool === 'point' ? ['x','y'] : tool === 'box' ? ['x','y','w','h'] : tool === 'polygon' ? ['points'] : ['rle','width','height','frames'];
  const data = object(value, [...keys, 'type']);
  if (data.type !== undefined && data.type !== tool) invalid('工具与几何类型不符');
  if (tool === 'point' || tool === 'box') {
    const x = coordinate(data.x), y = coordinate(data.y);
    if (tool === 'point') return { x, y };
    const w = coordinate(data.w), h = coordinate(data.h);
    if (!w || !h || !Number.isFinite(x+w) || !Number.isFinite(y+h)) invalid('矩形必须有有效面积');
    return { x, y, w, h };
  }
  if (tool === 'polygon') {
    if (!Array.isArray(data.points) || data.points.length < 3) invalid('多边形至少需要三个顶点');
    const points = data.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2) invalid('多边形坐标无效');
      return [coordinate(point[0]), coordinate(point[1])];
    });
    if (new Set(points.map(p => JSON.stringify(p))).size < 3) invalid('多边形至少需要三个不同顶点');
    let twiceArea = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      twiceArea += a[0]! * b[1]! - b[0]! * a[1]!;
    }
    if (!Number.isFinite(twiceArea) || twiceArea === 0) invalid('多边形必须有有效面积');
    return { points };
  }
  const representative = mask({ rle: data.rle, width: data.width, height: data.height });
  if (data.frames !== undefined && !Array.isArray(data.frames)) invalid('逐帧掩膜无效');
  const seen = new Set([key]);
  const frames = ((data.frames ?? []) as unknown[]).map(value => {
    const frame = object(value, ['frame_index', 'rle', 'width', 'height']);
    const index = integer(frame.frame_index);
    if (index < start || index > end || seen.has(index)) invalid('掩膜帧超出范围或重复');
    seen.add(index);
    const encoded = mask({ rle: frame.rle, width: frame.width, height: frame.height });
    if (encoded.width !== representative.width || encoded.height !== representative.height) invalid('逐帧掩膜尺寸不一致');
    return { frame_index: index, ...encoded };
  }).sort((a, b) => a.frame_index-b.frame_index);
  return { ...representative, frames };
}
export function parseAnnotations(body: unknown): { expected_version: number; annotations: AnnotationInput[] } {
  const input = object(body, ['expected_version', 'annotations']);
  const expected_version = integer(input.expected_version);
  if (!Array.isArray(input.annotations)) invalid('annotations 必须为数组');
  const annotations = input.annotations.map(value => {
    const item = object(value, ['id','series_id','tool','geometry','frame_start','frame_end','key_frame_index','window_preset','part_id','sign_tag_ids','confidence','report_sent_ids']);
    if (!['box','point','polygon','brush'].includes(item.tool as string)) invalid('标注工具无效');
    const tool = item.tool as AnnotationTool;
    const start = integer(item.frame_start), end = integer(item.frame_end), key = integer(item.key_frame_index);
    if (end < start || key < start || key > end) invalid('代表帧或起止范围无效');
    if (!Array.isArray(item.sign_tag_ids)) invalid('征象必须为数组');
    const signs = item.sign_tag_ids.map(uuid);
    if (new Set(signs).size !== signs.length) invalid('征象不能重复');
    if (!Array.isArray(item.report_sent_ids)) invalid('报告句号必须为数组');
    const sentences = item.report_sent_ids.map(v => v === REPORT_NOT_MENTIONED ? v : integer(v));
    if (new Set(sentences).size !== sentences.length || (sentences.includes(REPORT_NOT_MENTIONED) && sentences.length !== 1)) invalid('报告未提及不能与句号混用，句号不能重复');
    const confidence = item.confidence === 'typical' ? '典型' : item.confidence === 'atypical' ? '不典型' : item.confidence;
    if (confidence !== null && confidence !== '典型' && confidence !== '不典型') invalid('置信度无效');
    if (item.window_preset !== undefined && item.window_preset !== null && (typeof item.window_preset !== 'string' || !item.window_preset.trim())) invalid('窗预设无效');
    return { id: item.id === undefined ? randomUUID() : uuid(item.id), series_id: uuid(item.series_id), tool,
      geometry: geometry(tool, item.geometry, start, end, key), frame_start: start, frame_end: end, key_frame_index: key,
      window_preset: typeof item.window_preset === 'string' ? item.window_preset.trim() : null,
      part_id: item.part_id === null ? null : uuid(item.part_id), sign_tag_ids: signs, confidence, report_sent_ids: sentences } as AnnotationInput;
  });
  if (new Set(annotations.map(a => a.id)).size !== annotations.length) invalid('对象标识不能重复');
  return { expected_version, annotations };
}
