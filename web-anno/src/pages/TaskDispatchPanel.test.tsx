import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tasksApi, type Assignee, type ManualDispatch } from '../tasks/api';
import { syntheticCase, syntheticTask } from '../tasks/fixtures';
import { TaskDispatchPanel, unavailableReason } from './TaskDispatchPanel';
const user: Assignee = { id: '30000000-0000-4000-8000-000000000001', username: 'synthetic', real_name: '合成人员', role: 'member', quals: { resp: ['annotate'] }, status: 'active', expire_at: '2099-01-01', must_change_password: false, mfa_enabled: false, in_flight_limit: null };
const pageOf = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const nativeComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => nativeComputedStyle(element));
  vi.spyOn(tasksApi, 'cases').mockResolvedValue(pageOf([{ ...syntheticCase, status: '待分配' }, { ...syntheticCase, id: 'locked', case_no: 'LOCKED', status: '标注中', assignment_id: 'assignment-1' }]));
  vi.spyOn(tasksApi, 'assignees').mockResolvedValue(pageOf([user]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function show() {
  const changed = vi.fn(), busy = vi.fn();
  render(<TaskDispatchPanel token="token" task={syntheticTask} onChanged={changed} onBusyChange={busy} />);
  return { changed, busy };
}
async function choose() {
  await screen.findByText('SYN-TASK-1'); await screen.findByText('合成人员（synthetic）');
  const checkboxes = screen.getAllByRole('checkbox');
  expect(checkboxes[2]).toBeDisabled(); fireEvent.click(checkboxes[1]!);
  fireEvent.click(screen.getByRole('radio'));
}
describe('dispatch console', () => {
  it('preserves administrator manual review assignment with no default deadline', async () => {
    vi.mocked(tasksApi.cases).mockResolvedValue(pageOf([{...syntheticCase,status:'待审核'}]));
    vi.mocked(tasksApi.assignees).mockResolvedValue(pageOf([{...user,quals:{resp:['review']}}]));
    const dispatch=vi.spyOn(tasksApi,'dispatch').mockResolvedValue({mode:'manual',task_id:syntheticTask.id,case_ids:[syntheticCase.id],assignee_id:user.id,due_at:null,task_role:'review'});
    show();await screen.findByText('SYN-TASK-1');await screen.findByText('合成人员（synthetic）');
    fireEvent.mouseDown(screen.getByRole('combobox',{name:'指派角色'}));fireEvent.click(await screen.findByTitle('审核'));
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);fireEvent.click(screen.getByRole('radio'));fireEvent.click(screen.getByRole('button',{name:'确认指派'}));
    expect(await screen.findByText('审核指派成功，等待审核人开始')).toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith('token',{mode:'manual',task_id:syntheticTask.id,case_ids:[syntheticCase.id],assignee_id:user.id,due_at:null,task_role:'review'});
  });
  it('matches account and self-review qualification hints without inventing capacity limits', () => {
    expect(unavailableReason(user, syntheticTask)).toBeUndefined();
    expect(unavailableReason(user, { ...syntheticTask, review_mode: 'self' })).toContain('资格');
    expect(unavailableReason({ ...user, quals: { resp: ['annotate', 'review'] } }, { ...syntheticTask, review_mode: 'self' })).toBeUndefined();
    expect(unavailableReason({ ...user, status: 'disabled' }, syntheticTask)).toContain('账号');
    expect(unavailableReason({ ...user, role: 'admin' }, syntheticTask)).toContain('安全设置');
  });
  it('dispatches with no default deadline, locks repeat submission, and distinguishes refresh failure', async () => {
    let finish!: (value: ManualDispatch & { task_role: 'annotate' }) => void;
    const dispatch = vi.spyOn(tasksApi, 'dispatch').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { changed, busy } = show(); await choose();
    expect(screen.getByLabelText('分派截止时间')).toHaveValue('');
    const submit = screen.getByRole('button', { name: '确认指派' });
    fireEvent.click(submit);
    expect(submit).toBeDisabled(); fireEvent.click(submit);
    expect(dispatch).toHaveBeenCalledOnce();
    const input = { mode: 'manual' as const, task_id: syntheticTask.id, assignee_id: user.id, case_ids: [syntheticCase.id], due_at: null };
    expect(dispatch).toHaveBeenCalledWith('token', input); expect(busy).toHaveBeenCalledWith(true);
    vi.mocked(tasksApi.cases).mockRejectedValue(new Error('刷新失败'));
    await act(async () => finish({ ...input, task_role: 'annotate' }));
    expect(await screen.findByText('指派成功，病例已进入标注中')).toBeInTheDocument();
    expect(await screen.findByText('病例加载失败：刷新失败')).toBeInTheDocument();
    expect(screen.getByText('已选 0 例；仅可选择待分配病例。')).toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce(); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it('preserves selection on server conflict and converts an explicit local deadline to ISO', async () => {
    const dispatch = vi.spyOn(tasksApi, 'dispatch').mockRejectedValue(new Error('超过任务级或人员全局在途上限'));
    const { changed } = show(); await choose();
    fireEvent.change(screen.getByLabelText('分派截止时间'), { target: { value: '2099-01-01T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: '确认指派' }));
    expect(await screen.findByText('超过任务级或人员全局在途上限')).toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith('token', expect.objectContaining({ due_at: new Date('2099-01-01T12:00').toISOString() }));
    expect(screen.getByText('已选 1 例；仅可选择待分配病例。')).toBeInTheDocument(); expect(changed).not.toHaveBeenCalled();
  });
  it('rejects past deadlines before dispatch and clears selected cases on refresh', async () => {
    const dispatch = vi.spyOn(tasksApi, 'dispatch'); show(); await choose();
    fireEvent.change(screen.getByLabelText('分派截止时间'), { target: { value: '2000-01-01T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: '确认指派' }));
    expect(await screen.findByText('截止时间必须晚于当前时间')).toBeInTheDocument(); expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '刷新分派数据' }));
    expect(screen.getByText('已选 0 例；仅可选择待分配病例。')).toBeInTheDocument();
  });
  it('saves empty limits as null for the task and person', async () => {
    const settings = vi.spyOn(tasksApi, 'settings').mockResolvedValue({ id: syntheticTask.id, priority: 1, in_flight_limit: null });
    const person = vi.spyOn(tasksApi, 'personLimit').mockResolvedValue({ id: user.id, in_flight_limit: null });
    show(); await screen.findByText('合成人员（synthetic）');
    fireEvent.click(screen.getByRole('button', { name: '保存任务设置' }));
    await waitFor(() => expect(settings).toHaveBeenCalledWith('token', syntheticTask.id, { priority: 1, in_flight_limit: null, dispatch_mode: 'manual' }));
    await screen.findByText('任务设置已保存');
    fireEvent.click(screen.getByRole('button', { name: '设置 synthetic 全局上限' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存人员上限' }));
    await waitFor(() => expect(person).toHaveBeenCalledWith('token', user.id, null));
    expect(await screen.findByText('人员全局上限已保存')).toBeInTheDocument();
  });
  it('rejects invalid limits without sending settings and keeps a failed person edit open', async () => {
    const settings = vi.spyOn(tasksApi, 'settings');
    const person = vi.spyOn(tasksApi, 'personLimit').mockRejectedValue(new Error('账号已删除'));
    show(); await screen.findByText('合成人员（synthetic）');
    fireEvent.change(screen.getByLabelText('每人每任务在途上限'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务设置' }));
    expect(await screen.findByText('上限须为正整数或留空')).toBeInTheDocument(); expect(settings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '设置 synthetic 全局上限' }));
    fireEvent.change(await screen.findByLabelText('人员跨任务在途上限'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '保存人员上限' }));
    await waitFor(() => expect(person).toHaveBeenCalledWith('token', user.id, 12));
    expect((await screen.findAllByText('账号已删除')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('人员跨任务在途上限')).toHaveValue('12');
  });

  it('reclaims the exact assignment only after an explicit reason and reports pending automatic work', async () => {
    const reclaim = vi.spyOn(tasksApi, 'reclaim').mockResolvedValue({ auto_dispatch: { status: 'pending' } });
    show(); await screen.findByText('LOCKED'); fireEvent.click(screen.getByRole('button', { name: /回\s*收/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认回收' }));
    expect(await screen.findByText('请选择回收原因')).toBeInTheDocument(); expect(reclaim).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByLabelText('回收原因'));
    const choices = await screen.findAllByText('质量问题'); fireEvent.click(choices[choices.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: '确认回收' }));
    expect(await screen.findByText('分派已回收；自动派单尚未完成，请重试自动派单')).toBeInTheDocument();
    expect(reclaim).toHaveBeenCalledWith('token', 'assignment-1', 'quality');
  });
  it('continues automatic dispatch using the returned cursor instead of repeating an unassignable prefix', async () => {
    const auto = vi.spyOn(tasksApi, 'auto').mockResolvedValueOnce({ assigned: [], unassigned: [], next_case_id: 'cursor-case' }).mockResolvedValue({ assigned: [], unassigned: [], next_case_id: null });
    render(<TaskDispatchPanel token="token" task={{ ...syntheticTask, dispatch_mode: 'auto' }} onChanged={vi.fn()} onBusyChange={vi.fn()} />);
    await screen.findByText('LOCKED'); fireEvent.click(screen.getByRole('button', { name: '重试自动派单' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续下一批自动派单' }));
    await waitFor(() => expect(auto).toHaveBeenLastCalledWith('token', syntheticTask.id, 'cursor-case'));
  });

});

it('offers reclaim for an active published quality assignment without selecting it for normal dispatch',async()=>{
 vi.mocked(tasksApi.cases).mockResolvedValue(pageOf([{...syntheticCase,status:'已发布',assignment_id:'quality-id',quality_review:{kind:'spotcheck',state:'active',version:3}}]));
 const reclaim=vi.spyOn(tasksApi,'reclaim').mockResolvedValue({});show();await screen.findByText('SYN-TASK-1');
 expect(screen.getAllByRole('checkbox')[1]).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:/回\s*收/}));
 await screen.findByText(/回收后质量审核回到待派/);fireEvent.mouseDown(screen.getByLabelText('回收原因'));const choices=await screen.findAllByText('质量问题');fireEvent.click(choices.at(-1)!);
 fireEvent.click(screen.getByRole('button',{name:'确认回收'}));await screen.findByText('分派已回收');expect(reclaim).toHaveBeenCalledWith('token','quality-id','quality');
});
