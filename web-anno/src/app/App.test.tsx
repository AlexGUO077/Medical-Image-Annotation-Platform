import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { reviewsApi } from '../reviews/api';
vi.mock('../reviews/api',()=>({reviewsApi:{read:vi.fn().mockRejectedValue(new Error('审核病例不可访问'))}}));
import { clearAccountDrafts } from '../annotations/drafts';
vi.mock('../annotations/drafts', async importOriginal => ({ ...await importOriginal<typeof import('../annotations/drafts')>(), clearAccountDrafts: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../viewer/api', async original => ({...await original<typeof import('../viewer/api')>(),viewerApi:{workbench:vi.fn().mockRejectedValue(new Error('工作台病例不可访问')),clearPreloads:vi.fn()}}));
import { viewerApi } from '../viewer/api';
import { tasksApi } from '../tasks/api';
vi.mock('../tasks/api', async importOriginal => ({ ...await importOriginal<typeof import('../tasks/api')>(), tasksApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }), mine: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }), pool: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) } }));

beforeEach(() => {
  vi.mocked(clearAccountDrafts).mockReset().mockResolvedValue(undefined);
  vi.mocked(reviewsApi.read).mockRejectedValue(new Error('审核病例不可访问'));
  vi.mocked(viewerApi.workbench).mockRejectedValue(new Error('工作台病例不可访问'));
  for (const api of [tasksApi.list, tasksApi.mine, tasksApi.pool]) vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

const session = { token: 'synthetic-token', role: 'admin' as const, quals: {} };

describe('App', () => {
  it('renders the login form without business navigation', async () => {
    render(<App initialEntries={['/login']} />);

    expect(await screen.findByRole('heading', { name: '医学影像标注平台' })).toBeInTheDocument();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument();
  });

  it.each([
    ['/dashboard', '统计看板'],
  ])('renders a neutral module placeholder for %s', async (path, label) => {
    render(<App initialEntries={[path]} initialSession={session} />);

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText('该模块将在对应工作包实现')).toBeInTheDocument();
    expect(screen.queryByText(/已完成|可用|成功/)).not.toBeInTheDocument();
  });

  it('guards the new review route through the authenticated server read',async()=>{
    render(<App initialEntries={['/review/synthetic-case']} initialSession={session}/>);
    expect(await screen.findByText('审核病例不可访问')).toBeInTheDocument();
    expect(reviewsApi.read).toHaveBeenCalledWith('synthetic-case',session.token,expect.any(AbortSignal));
  });

  it('enters a member workbench through client navigation without losing the session', async () => {
    vi.mocked(tasksApi.mine).mockResolvedValue({ items: [{ task_id: 'task', task_name: '合成任务', priority: 0, source: 'synthetic', system_code: 'resp', review_mode: 'peer', case_id: 'case', case_no: 'SYN-ASSIGNED', status: '标注中' }], total: 1, page: 1, pageSize: 20 });
    render(<App initialEntries={['/tasks']} initialSession={{ ...session, role: 'member' }} />);
    fireEvent.click(await screen.findByRole('link', { name: '进入工作台' }));
    expect(await screen.findByText('工作台病例不可访问')).toBeInTheDocument();
    expect(viewerApi.workbench).toHaveBeenCalledWith('case', session.token, expect.any(AbortSignal));
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  });

  it('renders the administrator task workflow', async () => {
    render(<App initialEntries={['/tasks']} initialSession={session} />);
    expect(await screen.findByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(await screen.findByText('暂无符合条件的任务')).toBeInTheDocument();
    expect(tasksApi.list).toHaveBeenCalled();
  });

  it('renders the administrator batch import workflow', async () => {
    render(<App initialEntries={['/cases/import']} initialSession={session} />);

    expect(await screen.findByRole('heading', { name: '病例录入' })).toBeInTheDocument();
    expect(screen.getByText('批量导入')).toBeInTheDocument();
    expect(screen.queryByText('该模块将在对应工作包实现')).not.toBeInTheDocument();
  });

  it('renders the administrator case detail without exposing storage keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).endsWith('/report')
        ? { masked_report: '合成报告', sentences: [{ idx: 0, text: '合成报告' }] }
        : {
          id: 'synthetic-case', case_no: 'SYN-CASE', status: '已录入', source: 'synthetic',
          system_code: 'resp', confirm_method: '临床综合诊断', clinical_text: null,
          age_band: null, sex: null, teaching_fields: null, attachments: [],
        },
    ), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<App initialEntries={['/cases/synthetic-case']} initialSession={session} />);

    expect(await screen.findByText('SYN-CASE')).toBeInTheDocument();
    expect(await screen.findByText(/合成报告/)).toBeInTheDocument();
    expect(screen.queryByText('该模块将在对应工作包实现')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('redirects members away from the administrator route', async () => {
    render(<App initialEntries={['/admin']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '个人任务与标注领取池' })).toBeInTheDocument();
    expect(screen.queryByText('标签树与征象规范')).not.toBeInTheDocument();
  });

  it('redirects members away from case import', async () => {
    render(<App initialEntries={['/cases/import']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '个人任务与标注领取池' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '病例录入' })).not.toBeInTheDocument();
  });

  it('redirects members away from case detail', async () => {
    render(<App initialEntries={['/cases/synthetic-case']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '个人任务与标注领取池' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '病例与临床信息' })).not.toBeInTheDocument();
  });

  it('uses the dark workbench theme and reports denied access', async () => {
    render(<App initialEntries={['/workbench/synthetic-case']} initialSession={session} />);

    expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'dark');
    expect(await screen.findByText('工作台病例不可访问')).toBeInTheDocument();
  });

  it.each([
    ['/review/synthetic-case/', '审核台'],
  ])('uses the dark theme for valid trailing-slash route %s', async (path, label) => {
    render(<App initialEntries={[path]} initialSession={session} />);

    expect(await screen.findByText('审核病例不可访问')).toBeInTheDocument();
    expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'dark');
  });

  it('redirects unauthenticated protected routes to login', async () => {
    render(<App initialEntries={['/tasks']} />);

    expect(await screen.findByRole('heading', { name: '医学影像标注平台' })).toBeInTheDocument();
  });

  it.each(['/workbench/', '/workbench/a/b', '/review/', '/review/a/b'])(
    'redirects an invalid authenticated route to the task list: %s',
    async (path) => {
      render(<App initialEntries={[path]} initialSession={session} />);

      expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
      expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'light');
    },
  );
});

const draftAccount='12345678-1234-4234-8234-123456789abc';
const draftSession={...session,token:`e30.${btoa(JSON.stringify({sub:draftAccount}))}.signature`};
it('clears only the signed-in account drafts when logging out',async()=>{
 render(<App initialEntries={['/library']} initialSession={draftSession}/>);
 fireEvent.click(await screen.findByRole('button',{name:'退出登录'}));
 expect(clearAccountDrafts).toHaveBeenCalledWith(draftAccount);
 expect(await screen.findByLabelText('用户名')).toBeInTheDocument();
});
it('still exits the session and reports failed local draft cleanup with retry',async()=>{
 vi.mocked(clearAccountDrafts).mockRejectedValueOnce(new Error('disk unavailable'));
 render(<App initialEntries={['/library']} initialSession={draftSession}/>);
 fireEvent.click(await screen.findByRole('button',{name:'退出登录'}));
 expect(await screen.findByLabelText('用户名')).toBeInTheDocument();
 expect(await screen.findByText('上次退出时，本机标注草稿清理失败')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'重试清理（当前账号会退出）'}));
 expect(clearAccountDrafts).toHaveBeenCalledTimes(2);
});
