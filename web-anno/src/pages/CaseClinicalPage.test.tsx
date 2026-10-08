import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseEditApi, casesDetailApi, type CaseDetail } from '../cases/detail-api';
import { taxonomyApi } from '../taxonomy/api';
import { CaseClinicalPage } from './CaseClinicalPage';
const detail: CaseDetail = { id: 'case-1', case_no: 'SYN-1', status: '已录入', annotation_version: 2, source: 'synthetic', system_code: 'resp', confirm_method: '临床综合诊断',
  clinical_text: '', age_band: '', sex: '', teaching_fields: null, attachments: [] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function show(status = '已录入') {
  vi.spyOn(taxonomyApi, 'tree').mockResolvedValue({ tree: [{ id: 'root', parent_id: null, level: 1, name: '呼吸', synonyms: [], icd: null, children: [{ id: 'part', parent_id: 'root', level: 2, name: '肺', synonyms: [], icd: null, children: [{ id: 'disease', parent_id: 'part', level: 3, name: '合成疾病', synonyms: [], icd: null, children: [] }] }] }], sign_tags: [] });
  vi.spyOn(casesDetailApi, 'detail').mockResolvedValue({ ...detail, status });
  vi.spyOn(casesDetailApi, 'report').mockResolvedValue({ masked_report: 'safe', sentences: [{ idx: 0, text: 'safe' }] });
  return render(<MemoryRouter initialEntries={['/cases/case-1']}><Routes><Route path="/cases/:id" element={<CaseClinicalPage session={{ token: 'token', role: 'admin', quals: {} }} />} /></Routes></MemoryRouter>);
}
describe('CaseClinicalPage', () => {
  it('displays only server-returned masking counts and replaces input with masked text', async () => {
    const save = vi.spyOn(caseEditApi, 'clinical').mockResolvedValue({ clinical_text: '患者：某，45岁', age_band: '', sex: '', confirm_method: '临床综合诊断', masked_count: 1 });
    show();
    const input = await screen.findByLabelText('临床信息');
    fireEvent.change(input, { target: { value: '患者：张三，45岁' } });
    expect(screen.queryByText(/遮蔽 1 处/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存临床信息' }));
    expect(await screen.findByText('临床信息已保存，遮蔽 1 处')).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith('token', 'case-1', expect.objectContaining({ clinical_text: '患者：张三，45岁' }));
    expect(input).toHaveValue('患者：某，45岁');
  });
  it('shows save failure without claiming masking succeeded', async () => {
    vi.spyOn(caseEditApi, 'clinical').mockRejectedValue(new Error('脱敏不可用'));
    show(); await screen.findByLabelText('临床信息');
    fireEvent.click(screen.getByRole('button', { name: '保存临床信息' }));
    expect(await screen.findByText('脱敏不可用')).toBeInTheDocument();
    expect(screen.queryByText(/已保存，遮蔽/)).not.toBeInTheDocument();
  });
  it('persists teaching fields as individual sign points', async () => {
    const save = vi.spyOn(caseEditApi, 'teaching').mockResolvedValue({ difficulty: '简单', applicable_level: '本科', sign_points: ['安全要点'], masked_count: 0 });
    show(); await screen.findByLabelText('难度');
    fireEvent.change(screen.getByLabelText('难度'), { target: { value: '简单' } });
    fireEvent.change(screen.getByLabelText('适用层级'), { target: { value: '本科' } });
    fireEvent.change(screen.getByLabelText(/征象要点/), { target: { value: '安全要点\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存教学字段' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('token', 'case-1', { difficulty: '简单', applicable_level: '本科', sign_points: ['安全要点'] }));
  });
  it('saves the selected disease through the existing clinical endpoint', async () => {
    const save = vi.spyOn(caseEditApi, 'clinical').mockResolvedValue({ ...detail, clinical_text: '', age_band: '', sex: '', disease_tag_id: 'disease', masked_count: 0 });
    show();
    const selector = await screen.findByLabelText('疾病/分型');
    fireEvent.mouseDown(selector);
    fireEvent.click(await screen.findByText('肺 / 合成疾病'));
    fireEvent.click(screen.getByRole('button', { name: '保存临床信息' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('token', 'case-1', expect.objectContaining({ disease_tag_id: 'disease' })));
  });
  it('keeps published cases read-only', async () => {
    show('已发布');
    await screen.findByText('病例当前状态仅允许查看');
    expect(screen.queryByRole('button', { name: '保存临床信息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上传附件' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('临床信息')).toBeDisabled();
  });
});
