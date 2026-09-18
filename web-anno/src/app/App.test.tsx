import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it.each([
    ['/login', '登录'],
    ['/tasks', '任务列表'],
    ['/cases/import', '病例录入'],
    ['/library', '检索与归类'],
    ['/dashboard', '统计看板'],
    ['/admin', '系统管理'],
    ['/cases/synthetic-case', '病例与临床信息'],
    ['/workbench/synthetic-case', '标注工作台'],
    ['/review/synthetic-case', '审核台'],
  ])('renders a neutral module placeholder for %s', async (path, label) => {
    render(<App initialEntries={[path]} />);

    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText('该模块将在对应工作包实现')).toBeInTheDocument();
    expect(screen.queryByText(/已完成|可用|成功/)).not.toBeInTheDocument();
  });

  it('uses the dark workbench theme without presenting business state', () => {
    render(<App initialEntries={['/workbench/synthetic-case']} />);

    expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'dark');
    expect(screen.queryByText(/患者|权限|状态|数量/)).not.toBeInTheDocument();
  });

  it.each(['/workbench/', '/workbench/a/b', '/review/', '/review/a/b'])(
    'renders the neutral wildcard page with a light theme for invalid route %s',
    async (path) => {
      render(<App initialEntries={[path]} />);

      expect(await screen.findByRole('heading', { name: '页面' })).toBeInTheDocument();
      expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'light');
    },
  );
});
