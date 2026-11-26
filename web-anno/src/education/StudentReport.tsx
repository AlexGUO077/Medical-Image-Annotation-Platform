import { Input, Select } from 'antd';
import { ViewerIcon } from '../viewer/ViewerIcon';
import type { EducationFeedback, EducationWorkbench, StudentAnswer } from './types';

interface Props {
  answer: StudentAnswer;
  parts: EducationWorkbench['parts'];
  instructions: string;
  reference?: EducationFeedback['reference'];
  editable: boolean;
  onChange(answer: StudentAnswer): void;
}

function Comparison({ title, mine, doctor }: { title: string; mine: string; doctor?: string }) {
  return <section className="report-comparison">
    <h3>{title}</h3>
    <div className="report-pair">
      <section className="report-excerpt student-excerpt">
        <h4 aria-label={`我的${title}`}><ViewerIcon name="report"/>我的作答</h4>
        <p>{mine || '未填写'}</p>
      </section>
      {doctor && <section className="report-excerpt doctor-excerpt">
        <h4 aria-label={`医生${title}`}><ViewerIcon name="library"/>医生参考</h4>
        <p>{doctor}</p>
      </section>}
    </div>
  </section>;
}

export function StudentReport({ answer, parts, instructions, reference, editable, onChange }: Props) {
  if (reference) return <div className="education-form feedback-report">
    <dl className="report-parts">
      <dt>我的身体部位</dt><dd>{parts.find(p => p.id === answer.body_part_id)?.name ?? '未填写'}</dd>
      {reference.part_names.length > 0 && <><dt className="doctor-part">参考部位</dt><dd>{reference.part_names.join('、')}</dd></>}
    </dl>
    {answer.normal === true && !answer.objects.length && <p>原答卷记录为未见异常。</p>}
    <Comparison title="影像所见" mine={answer.findings} doctor={reference.findings}/>
    <Comparison title="诊断意见" mine={answer.impression} doctor={reference.impression}/>
    <details className="report-original" open={!reference.findings || !reference.impression}>
      <summary>参考报告原文</summary><p className="education-report">{reference.report}</p>
    </details>
    {!reference.annotations.length && <p className="education-instructions">本题仅提供报告对照。</p>}
  </div>;

  return <div className="education-form report-writing">
    {instructions && <p className="education-instructions">{instructions}</p>}
    <label className="education-field">身体部位
      <Select aria-label="身体部位" placeholder="选择身体部位" showSearch optionFilterProp="label"
        value={answer.body_part_id ?? undefined} disabled={!editable} options={parts.map(p => ({ value: p.id, label: p.name }))}
        onChange={value => onChange({ ...answer, body_part_id: value })}/>
    </label>
    <label className="education-field">影像所见
      <Input.TextArea aria-label="影像所见" autoSize={{ minRows: 6 }} maxLength={10000} value={answer.findings}
        disabled={!editable} placeholder="描述位置、形态、范围及影像表现" onChange={e => onChange({ ...answer, findings: e.target.value })}/>
    </label>
    <label className="education-field">诊断意见
      <Input.TextArea aria-label="诊断意见" autoSize={{ minRows: 4 }} maxLength={5000} value={answer.impression}
        disabled={!editable} placeholder="写下考虑的疾病及判断依据" onChange={e => onChange({ ...answer, impression: e.target.value })}/>
    </label>
  </div>;
}
