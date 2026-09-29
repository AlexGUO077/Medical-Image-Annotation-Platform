import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tasksApi, type Page, type TaskCase } from '../tasks/api';
import { syntheticCase, syntheticTask } from '../tasks/fixtures';
import { CreateTaskForm, TasksPage } from './TasksPage';
const session = { token: 'synthetic-token', role: 'admin' as const, quals: {} };
const pageOf = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
const nativeComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  // JSDOM has no pseudo-element layout; preserve normal style computation.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => nativeComputedStyle(element));
  vi.spyOn(tasksApi, 'mine').mockResolvedValue(pageOf([]));
  vi.spyOn(tasksApi, 'pool').mockResolvedValue(pageOf([]));
  vi.spyOn(tasksApi, 'list').mockResolvedValue(pageOf([syntheticTask]));
  vi.spyOn(tasksApi, 'eligible').mockResolvedValue(pageOf([syntheticCase]));
  vi.spyOn(tasksApi, 'cases').mockResolvedValue(pageOf([{ ...syntheticCase, status: '待分配' }]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function select(label: string, value: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  const options = await screen.findAllByText(value);
  fireEvent.click(options[options.length - 1]!);
}
async function prepare() {
  fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '合成创建任务' } });
  await select('数据来源', '合成数据');
  await select('系统', '呼吸');
  await select('审核模式', '他审');
  await screen.findByText('SYN-TASK-1');
  fireEvent.click(screen.getAllByRole('checkbox')[1]!);
}
describe('TasksPage', () => {
  it('never loads administrator task or candidate data for a member', () => {
    render(<TasksPage session={{ ...session, role: 'member' }} />);
    expect(screen.getByText('个人任务与标注领取池')).toBeInTheDocument();
    expect(tasksApi.list).not.toHaveBeenCalled(); expect(tasksApi.eligible).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '新建任务' })).not.toBeInTheDocument();
  });
  it('shows task cards and retrieves case details only on demand', async () => {
    render(<TasksPage session={session} />);
    expect(await screen.findByText('合成呼吸任务')).toBeInTheDocument();
    expect(screen.getByText('病例数：1')).toBeInTheDocument(); expect(tasksApi.cases).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看病例' }));
    expect(await screen.findByText('SYN-TASK-1')).toBeInTheDocument();
    expect(tasksApi.cases).toHaveBeenCalledWith(session.token, syntheticTask.id, 1, expect.any(AbortSignal));
  });
  it('keeps successful creation distinct from a failed list refresh', async () => {
    vi.mocked(tasksApi.list).mockResolvedValueOnce(pageOf([])).mockRejectedValue(new Error('列表不可用'));
    const create = vi.spyOn(tasksApi, 'create').mockImplementation(async (_token, input) => ({ ...input, id: syntheticTask.id, status: '进行中' }));
    render(<TasksPage session={session} />);
    await screen.findByText('暂无符合条件的任务');
    fireEvent.click(screen.getByRole('button', { name: '新建任务' })); await prepare();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(await screen.findByText('任务已创建，病例进入待分配')).toBeInTheDocument();
    expect(await screen.findByText('任务列表加载失败：列表不可用')).toBeInTheDocument();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(session.token, { name: '合成创建任务', source: 'synthetic', system_code: 'resp', review_mode: 'peer', priority: 0, dispatch_mode: 'auto', case_ids: [syntheticCase.id] });
  });
  it('preserves the form on a creation conflict and does not report success', async () => {
    vi.spyOn(tasksApi, 'create').mockRejectedValue(new Error('病例已属于其他任务'));
    const done = vi.fn(); render(<CreateTaskForm token={session.token} onCreated={done} />); await prepare();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(await screen.findByText('病例已属于其他任务')).toBeInTheDocument();
    expect(screen.getByLabelText('任务名称')).toHaveValue('合成创建任务');
    expect(screen.getByText('已选 1 例')).toBeInTheDocument(); expect(done).not.toHaveBeenCalled();
  });
  it('clears selected cases when source changes', async () => {
    vi.mocked(tasksApi.eligible).mockImplementation(async (_token, query) => pageOf(query.source === 'synthetic' ? [syntheticCase] : []));
    render(<CreateTaskForm token={session.token} onCreated={vi.fn()} />); await prepare();
    expect(screen.getByText('已选 1 例')).toBeInTheDocument();
    await select('数据来源', '老师提供的教学样例');
    expect(await screen.findByText('已选 0 例')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('SYN-TASK-1')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '创建任务' })).toBeDisabled();
  });
  it('ignores stale candidate responses after scope changes', async () => {
    let finish!: (value: Page<TaskCase>) => void;
    vi.mocked(tasksApi.eligible).mockImplementation((_token, query) => query.source === 'synthetic'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(pageOf([])));
    render(<CreateTaskForm token={session.token} onCreated={vi.fn()} />);
    await select('数据来源', '合成数据'); await select('系统', '呼吸');
    await waitFor(() => expect(finish).toBeDefined());
    await select('数据来源', '老师提供的教学样例');
    finish(pageOf([syntheticCase]));
    await waitFor(() => expect(screen.queryByText('SYN-TASK-1')).not.toBeInTheDocument());
    expect(screen.getByText('已选 0 例')).toBeInTheDocument();
  });
  it('rejects an overlong name without issuing a write request', async () => {
    const create = vi.spyOn(tasksApi, 'create'); render(<CreateTaskForm token={session.token} onCreated={vi.fn()} />); await prepare();
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '名'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(await screen.findByText('任务名称需为 1～200 个字符')).toBeInTheDocument(); expect(create).not.toHaveBeenCalled();
  });
});
