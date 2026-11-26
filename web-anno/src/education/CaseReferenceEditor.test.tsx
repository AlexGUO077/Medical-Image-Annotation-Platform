import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { casesDetailApi } from '../cases/detail-api';
import { CaseReferenceEditor } from './CaseReferenceEditor';
import type { CaseReferenceSections } from './types';

function Editor() {
  const [value,setValue] = useState<CaseReferenceSections>();
  return <CaseReferenceEditor token="local" caseId="case" caseNo="合成病例" value={value} onChange={setValue}/>;
}
it.each([
  ['【合成教学参考】\n影像所见：模拟区域。\n第二句。\n诊断意见：考虑模拟病变。','模拟区域。\n第二句。','考虑模拟病变。'],
  ['模拟区域。考虑模拟病变。','',''],
])('uses original wording and allows manual excerpts for an unstructured report',async (report,findings,impression)=>{
  vi.spyOn(casesDetailApi,'report').mockResolvedValue({masked_report:report,sentences:[]});
  render(<Editor/>);
  const field=await screen.findByLabelText('医生影像所见');
  expect(field).toHaveValue(findings);
  expect(screen.getByLabelText('医生诊断意见')).toHaveValue(impression);
  fireEvent.change(field,{target:{value:'模拟区域。'}});
  expect(field).toHaveValue('模拟区域。');
  vi.restoreAllMocks();
});
