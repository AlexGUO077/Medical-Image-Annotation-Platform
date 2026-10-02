import type { RleMask } from './rle';
import type { ReviewRecord } from '../reviews/types';
export type Geometry = { x: number; y: number } | { x: number; y: number; w: number; h: number } | { points: number[][] } | (RleMask & { frames?: (RleMask & { frame_index: number })[] });
export interface Annotation {
  id: string; series_id: string; tool: 'point' | 'box' | 'polygon' | 'brush'; geometry: Geometry;
  frame_start: number; frame_end: number; key_frame_index: number; window_preset: string | null;
  part_id: string | null; sign_tag_ids: string[]; confidence: 'typical' | 'atypical' | null; report_sent_ids: number[];
}
export interface AnnotationVersion { version: number; annotations: Annotation[] }
export interface AnnotationRead extends AnnotationVersion { current_version: number; latest_review?:ReviewRecord|null }
/** Explicit allowlist: neither server metadata nor future UI fields enter requests/local drafts. */
export function annotationPayload(items: readonly Annotation[]): Annotation[] {
  return items.map(a => {
    const g = a.geometry;
    const geometry: Geometry = a.tool === 'brush' ? (() => {
      const m = g as RleMask & { frames?: (RleMask & { frame_index: number })[] };
      return { width: m.width, height: m.height, rle: [...m.rle], ...(m.frames ? { frames: m.frames.map(f => ({ frame_index: f.frame_index, width: f.width, height: f.height, rle: [...f.rle] })) } : {}) };
    })() : a.tool === 'polygon' ? { points: (g as { points: number[][] }).points.map(p => [p[0], p[1]]) }
      : a.tool === 'box' ? (() => { const b = g as { x:number;y:number;w:number;h:number };return {x:b.x,y:b.y,w:b.w,h:b.h}; })()
      : { x: (g as {x:number}).x, y: (g as {y:number}).y };
    return { id:a.id, series_id:a.series_id, tool:a.tool, geometry, frame_start:a.frame_start, frame_end:a.frame_end,
      key_frame_index:a.key_frame_index, window_preset:a.window_preset, part_id:a.part_id, sign_tag_ids:[...a.sign_tag_ids], confidence:a.confidence, report_sent_ids:[...a.report_sent_ids] };
  });
}
