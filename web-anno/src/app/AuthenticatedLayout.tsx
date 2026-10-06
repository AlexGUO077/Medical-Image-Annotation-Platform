import { Button, Layout, Menu, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '../auth/types';

const { Header, Sider, Content } = Layout;

interface AuthenticatedLayoutProps {
  session: Session;
  children: React.ReactNode;
  onLogout(): void;
}

export function AuthenticatedLayout({ session, children, onLogout }: AuthenticatedLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const items = [
    { key: '/tasks', label: '任务列表' },
    { key: '/library', label: '病例库' },
    ...(session.role === 'admin' ? [
      { key: '/cases/import', label: '病例录入' },
      { key: '/dashboard', label: '统计看板' },
      { key: '/admin', label: '系统管理' },
    ] : []),
  ];
  return (
    <Layout className="app-shell">
      <Sider width={208} theme="light">
        <div className="app-brand">医学影像标注平台</div>
        <Menu
          mode="inline"
          items={items}
          selectedKeys={[location.pathname.startsWith('/library/')?'/library':location.pathname]}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Text>{session.role === 'admin' ? '管理员' : '业务人员'}</Typography.Text>
          <Button onClick={onLogout}>退出登录</Button>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
