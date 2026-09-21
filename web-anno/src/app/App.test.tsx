import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
    ['/cases/import', '病例录入'],
    ['/library', '检索与归类'],
    ['/dashboard', '统计看板'],
    ['/cases/synthetic-case', '病例与临床信息'],
    ['/workbench/synthetic-case', '标注工作台'],
    ['/review/synthetic-case', '审核台'],
  ])('renders a neutral module placeholder for %s', async (path, label) => {
    render(<App initialEntries={[path]} initialSession={session} />);

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText('该模块将在对应工作包实现')).toBeInTheDocument();
    expect(screen.queryByText(/已完成|可用|成功/)).not.toBeInTheDocument();
  });

  it('redirects members away from the administrator route', async () => {
    render(<App initialEntries={['/admin']} initialSession={{ ...session, role: 'member' }} />);

    expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument();
    expect(screen.queryByText('标签树与征象规范')).not.toBeInTheDocument();
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
