import { Alert, Button, Input, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { casesDetailApi } from '../cases/detail-api';
import type { CaseReferenceSections } from './types';

// Headings only prefill the editor. The administrator reviews the original wording.
function fromHeadings(report: string) {
  const headings = [...report.matchAll(/(?:^|[\r\n])[ \t]*(?:【([^】\n]+)】[ \t]*[：:]?|([^：:\n]{2,12})[：:])/g)];
  const fields = { findings: '', impression: '' };
  for (const [i, match] of headings.entries()) {
    const name = (match[1] ?? match[2]).trim();
    const content = report.slice(match.index + match[0].length, headings[i + 1]?.index).trim();
    if (/^(影像所见|检查所见|所见)$/.test(name)) fields.findings = content;
    if (/^(诊断意见|诊断提示|影像诊断|检查结论|印象|诊断)$/.test(name)) fields.impression = content;
  }
  return fields;
}

export function CaseReferenceEditor({ token, caseId, caseNo, value, onChange }: {
  token: string; caseId: string; caseNo: string; value?: CaseReferenceSections;
  onChange(value: CaseReferenceSections): void;
}) {
  const [report, setReport] = useState<string>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    casesDetailApi.report(token, caseId).then(({ masked_report }) => {
      if (!active) return;
      setReport(masked_report);
      if (!value) onChange({ case_id: caseId, ...fromHeadings(masked_report) });
    }).catch(() => { if (active) setError('无法读取该病例的脱敏报告'); });
    return () => { active = false; };
  }, [token, caseId, retry]);
  if (error) return <Alert message={error} action={<Button onClick={() => setRetry(n => n + 1)}>重试</Button>}/>;
  if (report === undefined || !value) return <Spin size="small"/>;
  return <fieldset className="education-reference-editor">
    <legend>{caseNo} · 医生参考报告</legend>
    <details open={!value.findings || !value.impression}><summary>查看脱敏原文</summary><p className="education-report">{report}</p></details>
    <label>医生影像所见<Input.TextArea rows={2} maxLength={10000} value={value.findings}
      placeholder="摘取原报告中描述病灶位置、形态和表现的文字"
      onChange={e => onChange({ ...value, findings: e.target.value })}/></label>
    <label>医生诊断意见<Input.TextArea rows={2} maxLength={5000} value={value.impression}
      placeholder="摘取原报告中对可能疾病的判断，保留原文表述"
      onChange={e => onChange({ ...value, impression: e.target.value })}/></label>
  </fieldset>;
}
