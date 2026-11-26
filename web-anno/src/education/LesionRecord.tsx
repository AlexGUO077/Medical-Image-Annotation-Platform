import { Button, Input, InputNumber, Select } from 'antd';
import { pointFrames } from '../annotations/point-marks';
import type { EducationWorkbench, StudentObject } from './types';

interface Props {
  object: StudentObject;
  number: number;
  data: EducationWorkbench;
  feedback: boolean;
  editable: boolean;
  canCopy: boolean;
  onChange(patch: Partial<StudentObject>): void;
  onCopy(): void;
}

export function LesionRecord({ object: o, number, data, feedback, editable, canCopy, onChange, onCopy }: Props) {
  const partOptions = data.parts.map(p => ({ value: p.id, label: p.name }));
  const signOptions = data.signs.map(s => ({ value: s.id, label: s.name }));
  if (feedback) {
    const signs = data.signs.filter(s => o.sign_tag_ids.includes(s.id)).map(s => s.name);
    return <section className="lesion-record">
      <h3>病灶 {number} 的记录</h3>
      <dl className="lesion-readout"><dt>器官 / 位置</dt><dd>{o.organ || '未填写'}</dd>
        <dt>病变描述</dt><dd>{o.description || '未填写'}</dd>
        {signs.length > 0 && <><dt>征象</dt><dd>{signs.join('、')}</dd></>}
        {o.part_id && <><dt>对象部位</dt><dd>{data.parts.find(p => p.id === o.part_id)?.name ?? '未收录'}</dd></>}
      </dl>
    </section>;
  }
  const count = data.series.find(s => s.id === o.series_id)?.frame_count;
  const frames = o.tool === 'point' ? pointFrames(o) : [o.key_frame_index];
  const minFrame = Math.min(...frames) + 1, maxFrame = Math.max(...frames) + 1;
  return <section className="lesion-record">
    <h3>病灶 {number} 的记录</h3>
    <label className="education-field">器官 / 位置
      <Input aria-label="器官 / 位置" placeholder="填写器官及具体位置" maxLength={100} value={o.organ}
        disabled={!editable} onChange={e => onChange({ organ: e.target.value })}/>
    </label>
    <label className="education-field">病变描述
      <Input.TextArea aria-label="病变描述" autoSize={{ minRows: 4 }} maxLength={2000} value={o.description}
        placeholder="记录这个病灶的影像表现" disabled={!editable} onChange={e => onChange({ description: e.target.value })}/>
    </label>
    <details className="lesion-options">
      <summary>征象、部位与帧范围</summary>
      <label className="education-field">征象<Select aria-label="征象" mode="multiple" showSearch optionFilterProp="label"
        options={signOptions} value={o.sign_tag_ids} disabled={!editable} onChange={v => onChange({ sign_tag_ids: v })}/></label>
      <label className="education-field">对象部位<Select aria-label="对象部位" allowClear showSearch optionFilterProp="label"
        options={partOptions} value={o.part_id ?? undefined} disabled={!editable} onChange={v => onChange({ part_id: v ?? null })}/></label>
      <div className="lesion-frame-range">
        <label>起始帧<InputNumber aria-label="起始帧" min={1} max={minFrame} precision={0} value={o.frame_start + 1}
          disabled={!editable} onChange={v => { if (v && v <= minFrame) onChange({ frame_start: v - 1 }); }}/></label>
        <label>结束帧<InputNumber aria-label="结束帧" min={maxFrame} max={count} precision={0} value={o.frame_end + 1}
          disabled={!editable} onChange={v => { if (v && v >= maxFrame) onChange({ frame_end: v - 1 }); }}/></label>
      </div>
      <Button disabled={!editable || !canCopy} onClick={onCopy}>复制到下一帧</Button>
    </details>
  </section>;
}
