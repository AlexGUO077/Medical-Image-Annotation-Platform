import type { CSSProperties } from 'react';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { objectColor, toolDefinitions } from '../viewer/workspaceConfig';
import type { PointGeometry } from '../annotations/types';
import type { StudentObject } from './types';

interface Props {
  object: StudentObject;
  index: number;
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  feedback: boolean;
  editable: boolean;
  onSelect(): void;
  onHide(): void;
  onLock(): void;
  onDelete(): void;
}

export function LesionCard(p: Props) {
  const o = p.object, n = p.index + 1;
  const tool = toolDefinitions.find(item => item.id === o.tool)?.label;
  const pointCount = 1 + ((o.geometry as PointGeometry).additional_points?.length ?? 0);
  const frame = o.frame_start === o.frame_end ? `第 ${o.key_frame_index + 1} 帧` : `第 ${o.frame_start + 1}–${o.frame_end + 1} 帧`;
  const complete = o.organ.trim() && o.description.trim();
  const metaId = `lesion-meta-${o.id}`;
  return <li className="education-object" data-selected={p.selected} data-hidden={p.hidden}
    style={{ '--lesion-color': objectColor(p.index) } as CSSProperties}>
    <button type="button" className="lesion-select" aria-label={`病灶 ${n} · ${o.organ || '待填写位置'}`}
      aria-pressed={p.selected} aria-describedby={metaId} onClick={p.onSelect}>
      <span className="lesion-glyph"><ViewerIcon name={o.tool}/></span>
      <span className="lesion-identity"><span className="lesion-index">病灶 {String(n).padStart(2, '0')}</span>
        <strong>{o.organ || '待填写位置'}</strong></span>
      <span className="lesion-meta" id={metaId}><span>{o.tool === 'point' ? `点标注 · ${pointCount} 点` : tool}</span><span>{frame}</span>
        {!complete && <span className="lesion-incomplete">待补全</span>}</span>
    </button>
    <div className="lesion-actions">
      <button type="button" aria-label={`${p.hidden ? '显示' : '隐藏'}病灶 ${n}`} title={p.hidden ? '显示轮廓' : '隐藏轮廓'} aria-pressed={p.hidden} onClick={p.onHide}><ViewerIcon name={p.hidden ? 'hidden' : 'eye'}/></button>
      {!p.feedback && <>
        <button type="button" aria-label={`${p.locked ? '解锁' : '锁定'}病灶 ${n}`} title={p.locked ? '解锁病灶' : '锁定病灶'} aria-pressed={p.locked} disabled={!p.editable} onClick={p.onLock}><ViewerIcon name={p.locked ? 'lock' : 'unlock'}/></button>
        <button type="button" className="lesion-delete" aria-label={`删除病灶 ${n}`} title="删除病灶" disabled={!p.editable || p.locked} onClick={p.onDelete}><ViewerIcon name="trash"/></button>
      </>}
    </div>
  </li>;
}
