import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render as baseRender, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tasksApi, type QueueCase } from '../tasks/api';
import { MemberTasksPanel } from './MemberTasksPanel';
const row: QueueCase = { task_id: 'task', task_name: '合成任务', priority: 2, source: 'synthetic', system_code: 'resp', review_mode: 'peer', case_id: 'case', case_no: 'SYN-POOL', status: '待分配' };
const page = (items: QueueCase[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const nativeStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => nativeStyle(element));
  vi.spyOn(tasksApi, 'pool').mockResolvedValue(page([row]));
  vi.spyOn(tasksApi, 'mine').mockResolvedValue(page([]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('member task pool', () => {
  it('reads review queues without starting them and explicitly starts the assigned review', async () => {
    vi.mocked(tasksApi.pool).mockResolvedValue(page([]));
    vi.mocked(tasksApi.mine).mockImplementation(async (_token,_page,_signal,role) => page(role==='review'?[{...row,status:'待审核'}]:[]));
    const start=vi.spyOn(tasksApi,'startReview').mockImplementation(async()=>{
      vi.mocked(tasksApi.mine).mockResolvedValue(page([{...row,status:'审核中'}]));
      return {case_id:'case',status:'审核中'};
    });
    render(<MemberTasksPanel token="token" />);
    fireEvent.mouseDown(screen.getByRole('combobox',{name:'任务角色'}));fireEvent.click(await screen.findByTitle('审核'));
    await screen.findByText('SYN-POOL');expect(start).not.toHaveBeenCalled();expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'开始审核'}));
    expect(await screen.findByRole('link',{name:'进入审核台'})).toHaveAttribute('href','/review/case');expect(start).toHaveBeenCalledWith('token','task','case');
  });
  it('claims for the current account and separates successful claim from a failed refresh', async () => {
    const claim = vi.spyOn(tasksApi, 'claim').mockResolvedValue({ mode: 'manual', task_id: 'task', case_ids: ['case'], assignee_id: 'me', due_at: null });
    render(<MemberTasksPanel token="token" />); await screen.findByText('SYN-POOL');
    vi.mocked(tasksApi.pool).mockRejectedValue(new Error('列表不可用'));
    fireEvent.click(screen.getByRole('button', { name: /领\s*取/ }));
    expect(await screen.findByText('领取成功，病例已进入标注中')).toBeInTheDocument();
    expect(await screen.findByText('领取池加载失败：列表不可用')).toBeInTheDocument();
    expect(claim).toHaveBeenCalledWith('token', 'task', 'case','annotate'); expect(claim).toHaveBeenCalledOnce();
  });
  it('keeps the candidate on a conflicting claim and exposes no success or workbench link', async () => {
    vi.spyOn(tasksApi, 'claim').mockRejectedValue(new Error('病例状态已变化'));
    render(<MemberTasksPanel token="token" />); await screen.findByText('SYN-POOL');
    fireEvent.click(screen.getByRole('button', { name: /领\s*取/ }));
    expect(await screen.findByText('病例状态已变化')).toBeInTheDocument();
    expect(screen.getByText('SYN-POOL')).toBeInTheDocument(); expect(screen.queryByText('领取成功，病例已进入标注中')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('aborts old account reads and never displays their delayed results', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    vi.mocked(tasksApi.pool).mockImplementation(token => token === 'old' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(page([])));
    const view = render(<MemberTasksPanel token="old" />); await waitFor(() => expect(finish).toBeDefined());
    view.rerender(<MemberTasksPanel token="new" />); finish(page([row]));
    await waitFor(() => expect(screen.queryByText('SYN-POOL')).not.toBeInTheDocument());
    expect(tasksApi.pool).toHaveBeenCalledWith('new', 1, expect.any(AbortSignal),'annotate');
  });
});

function render(ui: ReactElement) { return baseRender(ui, { wrapper: MemoryRouter }); }

it('starts a published quality assignment explicitly and keeps its assignment identity',async()=>{
 vi.mocked(tasksApi.pool).mockResolvedValue(page([]));
 const quality={...row,status:'已发布',review_kind:'spotcheck' as const,review_version:3,assignment_id:'quality-id',started_at:null};
 vi.mocked(tasksApi.mine).mockImplementation(async(_token,_page,_signal,role)=>page(role==='review'?[quality]:[]));
 const start=vi.spyOn(tasksApi,'startReview').mockImplementation(async()=>{vi.mocked(tasksApi.mine).mockResolvedValue(page([{...quality,started_at:'2026-10-02T13:00:00Z'}]));return {case_id:'case',status:'已发布'};});
 render(<MemberTasksPanel token="token"/>);fireEvent.mouseDown(screen.getByRole('combobox',{name:'任务角色'}));fireEvent.click(await screen.findByTitle('审核'));
 fireEvent.click(await screen.findByRole('button',{name:'开始审核'}));expect(await screen.findByRole('link',{name:'进入审核台'})).toHaveAttribute('href','/review/case');
 expect(start).toHaveBeenCalledWith('token','task','case','quality-id');
});
