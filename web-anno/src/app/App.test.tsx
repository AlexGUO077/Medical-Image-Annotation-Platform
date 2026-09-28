import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

const session = { token: 'synthetic-token', role: 'admin' as const, quals: {} };

describe('App', () => {
  it('renders the login form without business navigation', async () => {
    render(<App initialEntries={['/login']} />);

    expect(await screen.findByRole('heading', { name: '医学影像标注平台' })).toBeInTheDocument();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.queryByText('任务列表')).not.toBeInTheDocument();
  });

  it.each([
    ['/tasks', '任务列表'],
    ['/library', '检索与归类'],
    ['/dashboard', '统计看板'],
    ['/workbench/synthetic-case', '标注工作台'],
    ['/review/synthetic-case', '审核台'],
  ])('renders a neutral module placeholder for %s', async (path, label) => {
    render(<App initialEntries={[path]} initialSession={session} />);

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText('该模块将在对应工作包实现')).toBeInTheDocument();
    expect(screen.queryByText(/已完成|可用|成功/)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
    expect(screen.queryByText('标签树与征象规范')).not.toBeInTheDocument();
  });

  it('redirects members away from case import', async () => {
    render(<App initialEntries={['/cases/import']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '病例录入' })).not.toBeInTheDocument();
  });

  it('redirects members away from case detail', async () => {
    render(<App initialEntries={['/cases/synthetic-case']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '病例与临床信息' })).not.toBeInTheDocument();
  });

  it('uses the dark workbench theme without presenting business state', () => {
    render(<App initialEntries={['/workbench/synthetic-case']} initialSession={session} />);

    expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'dark');
    expect(screen.queryByText(/患者|权限|状态|数量/)).not.toBeInTheDocument();
  });

  it.each([
    ['/workbench/synthetic-case/', '标注工作台'],
    ['/review/synthetic-case/', '审核台'],
  ])('uses the dark theme for valid trailing-slash route %s', async (path, label) => {
    render(<App initialEntries={[path]} initialSession={session} />);

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
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
