import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { WorkbenchPage } from './WorkbenchPage';
import { viewerApi, type Workbench } from '../viewer/api';
import { mountFrame } from '../viewer/cornerstone';
vi.mock('../viewer/api', async original => ({...await original<typeof import('../viewer/api')>(),viewerApi:{workbench:vi.fn(),clearPreloads:vi.fn()}}));
vi.mock('../viewer/cornerstone', () => ({ mountFrame: vi.fn() }));
const data: Workbench = { case: { id: 'case', case_no: 'SYN-WORKBENCH', source: 'synthetic', system_code: 'resp', status: '标注中', clinical_text: null, age_band: null, sex: null, confirm_method: '临床综合诊断' }, series: [{ id: 'series', series_uid: '2.25.1', modality: 'CT', frame_count: 300, default_window: { center: 40, width: 400 } }], sentences: [{ idx: 0, text: '合成报告句子' }], attachments: [] };
const session = { token: 'synthetic-token', role: 'member' as const, quals: { resp: ['annotate' as const] } };
const controls = { geometry:{width:640,height:480,row_spacing:1,column_spacing:1},toCanvas:(x:number,y:number):[number,number]=>[x,y],toImage:(x:number,y:number):[number,number]=>[x,y],subscribe:()=>()=>{}, zoom: vi.fn(), pan: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
beforeEach(() => {
  vi.mocked(viewerApi.workbench).mockResolvedValue(data);
  vi.mocked(mountFrame).mockResolvedValue(controls);
});
const show = () => render(<MemoryRouter initialEntries={['/workbench/case']}><Routes><Route path="/workbench/:caseId" element={<WorkbenchPage session={session} />} /></Routes></MemoryRouter>);
it('loads assigned data, changes frame/window, and aborts old frame reads', async () => {
  const view = show();
  expect(await screen.findByText('SYN-WORKBENCH')).toBeInTheDocument();
  expect(screen.getByText('合成报告句子')).toBeInTheDocument();
  await waitFor(() => expect(mountFrame).toHaveBeenCalled());
  const oldSignal = vi.mocked(mountFrame).mock.calls.at(-1)![6];
  fireEvent.click(screen.getByRole('button', { name: '下一帧' }));
  await waitFor(() => expect(mountFrame).toHaveBeenLastCalledWith(expect.any(HTMLDivElement), session.token, 'case', data.series[0], 1, { center: 40, width: 400 }, expect.any(AbortSignal)));
  expect(oldSignal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '窗设置' }));
  fireEvent.change(await screen.findByRole('spinbutton', { name: '窗位' }), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: '应用窗设置' }));
  await waitFor(() => expect(mountFrame).toHaveBeenLastCalledWith(expect.anything(), session.token, 'case', data.series[0], 1, { center: 50, width: 400 }, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: '影像专注模式' }));
  expect(screen.getByText('合成报告句子')).not.toBeVisible();
  const activeSignal = vi.mocked(mountFrame).mock.calls.at(-1)![6];
  view.unmount(); expect(activeSignal.aborted).toBe(true);
});
it('shows denied access without opening a frame', async () => {
  vi.mocked(mountFrame).mockClear();
  vi.mocked(viewerApi.workbench).mockRejectedValue(new Error('工作台病例不可访问'));
  show(); expect(await screen.findByText('工作台病例不可访问')).toBeInTheDocument(); expect(mountFrame).not.toHaveBeenCalled();
});
it('keeps frame controls disabled after a failed load', async () => {
  vi.mocked(mountFrame).mockRejectedValue(new Error('账号已停用'));
  show(); expect(await screen.findByText('账号已停用')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /放\s*大/ })).toBeDisabled();
});
