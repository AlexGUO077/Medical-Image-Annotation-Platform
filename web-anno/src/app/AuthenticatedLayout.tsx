import { Button, Layout, Menu, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '../auth/types';
import { isDarkThemePath } from './routes';
import { ViewerIcon } from '../viewer/ViewerIcon';

const { Header, Sider, Content } = Layout;

interface AuthenticatedLayoutProps {
  session: Session;
  children: React.ReactNode;
  onLogout(): void;
}

export function AuthenticatedLayout({ session, children, onLogout }: AuthenticatedLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const viewing = isDarkThemePath(location.pathname);
  const items = [
    { key: '/tasks', label: '任务列表', icon: <ViewerIcon name="list" /> },
    { key: '/library', label: '病例库', icon: <ViewerIcon name="library" /> },
    ...(session.role === 'admin' ? [
      { key: '/cases/import', label: '病例录入', icon: <ViewerIcon name="upload" /> },
      { key: '/dashboard', label: '统计看板', icon: <ViewerIcon name="chart" /> },
      { key: '/admin', label: '系统管理', icon: <ViewerIcon name="settings" /> },
    ] : []),
  ];
  return (
    <Layout className={`app-shell${viewing ? ' is-viewing' : ''}`}>
      <Sider width={184} collapsed={viewing} collapsedWidth={48} theme={viewing ? 'dark' : 'light'}>
        <div className="app-brand" title="医学影像标注平台">{viewing ? <ViewerIcon name="layout" /> : '医学影像标注平台'}</div>
        <Menu
          mode="inline"
          theme={viewing ? 'dark' : 'light'}
          items={items}
          selectedKeys={[location.pathname.startsWith('/library/')?'/library':viewing?'/tasks':location.pathname]}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span className="app-header-title">{viewing ? '医学影像标注平台' : items.find(item => location.pathname.startsWith(item.key))?.label ?? '医学影像标注平台'}</span>
          <Typography.Text>{session.role === 'admin' ? '管理员' : '业务人员'}</Typography.Text>
          <Button onClick={onLogout}>退出登录</Button>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
