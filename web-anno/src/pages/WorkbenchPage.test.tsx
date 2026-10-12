import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkbenchPage } from './WorkbenchPage';
import { ViewerRequestError, viewerApi, type Workbench } from '../viewer/api';
import { mountFrame } from '../viewer/cornerstone';
vi.mock('../viewer/api', async original => ({...await original<typeof import('../viewer/api')>(),viewerApi:{workbench:vi.fn(),clearPreloads:vi.fn()}}));
vi.mock('../viewer/cornerstone', () => ({ mountFrame: vi.fn() }));
const data: Workbench = { case: { id: 'case', case_no: 'SYN-WORKBENCH', source: 'synthetic', system_code: 'resp', status: '标注中', clinical_text: null, age_band: null, sex: null, confirm_method: '临床综合诊断' }, series: [{ id: 'series', series_uid: '2.25.1', modality: 'CT', frame_count: 300, default_window: { center: 40, width: 400 } }], sentences: [{ idx: 0, text: '合成报告句子' }], attachments: [] };
const session = { token: 'synthetic-token', role: 'member' as const, quals: { resp: ['annotate' as const] } };
const controls = { geometry:{width:640,height:480,row_spacing:1,column_spacing:1},toCanvas:(x:number,y:number):[number,number]=>[x,y],toImage:(x:number,y:number):[number,number]=>[x,y],subscribe:()=>()=>{}, zoom: vi.fn(), pan: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(viewerApi.workbench).mockResolvedValue(data);
  vi.mocked(mountFrame).mockResolvedValue(controls);
});
afterEach(() => vi.useRealTimers());
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

it.each([null, { ...data, case: { ...data.case, id: 'another-case' } }])('rejects a mismatched or missing case response and allows retry', async response => {
  vi.mocked(viewerApi.workbench).mockResolvedValueOnce(response as Workbench);
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('工作台返回的病例与当前任务不一致');
  expect(screen.queryByText('加载工作台')).not.toBeInTheDocument();
  expect(mountFrame).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '返回任务列表' })).toHaveAttribute('href', '/tasks');
  fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
  expect(await screen.findByText('SYN-WORKBENCH')).toBeInTheDocument();
  expect(viewerApi.workbench).toHaveBeenCalledTimes(2);
});

it('ends a stalled request after 30 seconds and ignores its late response', async () => {
  vi.useFakeTimers();
  let resolve!: (value: Workbench) => void;
  vi.mocked(viewerApi.workbench).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = show();
  expect(screen.getByRole('status')).toHaveTextContent('加载工作台');
  const signal = vi.mocked(viewerApi.workbench).mock.calls[0][2];
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('工作台加载超时');
  await act(async () => resolve(data));
  expect(screen.queryByText('SYN-WORKBENCH')).not.toBeInTheDocument();
  expect(mountFrame).not.toHaveBeenCalled();
  view.unmount();
});

it('aborts the previous case request and never displays its late response after navigation', async () => {
  let resolveFirst!: (value: Workbench) => void;
  let resolveSecond!: (value: Workbench) => void;
  vi.mocked(viewerApi.workbench)
    .mockImplementationOnce(() => new Promise(done => { resolveFirst = done; }))
    .mockImplementationOnce(() => new Promise(done => { resolveSecond = done; }));
  render(<MemoryRouter initialEntries={['/workbench/case']}><Link to="/workbench/second">打开第二例</Link><Routes><Route path="/workbench/:caseId" element={<WorkbenchPage session={session} />} /></Routes></MemoryRouter>);
  const oldSignal = vi.mocked(viewerApi.workbench).mock.calls[0][2];
  fireEvent.click(screen.getByRole('link', { name: '打开第二例' }));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolveSecond({ ...data, case: { ...data.case, id: 'second', case_no: 'SYN-SECOND' } }));
  expect(await screen.findByText('SYN-SECOND')).toBeInTheDocument();
  await act(async () => resolveFirst(data));
  expect(screen.queryByText('SYN-WORKBENCH')).not.toBeInTheDocument();
  expect(screen.getByText('SYN-SECOND')).toBeInTheDocument();
  expect(vi.mocked(mountFrame).mock.calls.every(call => call[2] === 'second')).toBe(true);
});

it('preserves session-expiry handling without opening a frame', async () => {
  const expired = vi.fn();
  vi.mocked(viewerApi.workbench).mockRejectedValue(new ViewerRequestError(401, '登录已失效'));
  render(<MemoryRouter initialEntries={['/workbench/case']}><Routes><Route path="/workbench/:caseId" element={<WorkbenchPage session={session} onExpired={expired} />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('登录已失效');
  expect(expired).toHaveBeenCalledOnce();
  expect(mountFrame).not.toHaveBeenCalled();
});
