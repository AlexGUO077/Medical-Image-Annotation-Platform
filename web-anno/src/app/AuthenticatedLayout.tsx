import { Button, Layout, Menu, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
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
  const [navOpen, setNavOpen] = useState(false);
  const navHandle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  const items = session.role === 'student' ? [{key:'/student',label:'我的考核',icon:<ViewerIcon name="list"/>},{key:'/student/account',label:'修改密码',icon:<ViewerIcon name="settings"/>}] : [
    { key: '/tasks', label: '任务列表', icon: <ViewerIcon name="list" /> },
    { key: '/library', label: '病例库', icon: <ViewerIcon name="library" /> },
    ...(session.role === 'admin' ? [
      { key: '/education', label: '学生与考核', icon: <ViewerIcon name="list" /> },
      { key: '/cases/import', label: '病例录入', icon: <ViewerIcon name="upload" /> },
      { key: '/dashboard', label: '统计看板', icon: <ViewerIcon name="chart" /> },
      { key: '/admin', label: '系统管理', icon: <ViewerIcon name="settings" /> },
    ] : []),
  ];
  const menu = <Menu
          mode="inline"
          theme={viewing ? 'dark' : 'light'}
          items={items}
          selectedKeys={[session.role==='student'?(location.pathname==='/student/account'?'/student/account':'/student'):location.pathname.startsWith('/library/')?'/library':viewing?'/tasks':location.pathname]}
          onClick={({ key }) => navigate(key)}
        />;
  const closeNav = () => { setNavOpen(false); navHandle.current?.focus(); };
  return (
    <Layout hasSider={!viewing} className={`app-shell${viewing ? ' is-viewing' : ''}`}>
      {viewing ? <nav className="viewer-navigation" aria-label="主导航" data-open={navOpen}
        onPointerEnter={e => { if (e.pointerType === 'mouse') setNavOpen(true); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse' && !e.currentTarget.querySelector(':focus-visible')) setNavOpen(false); }}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setNavOpen(false); }}
        onKeyDown={e => { if (e.key === 'Escape' && navOpen) { e.stopPropagation(); closeNav(); } }}>
        <button type="button" className="viewer-nav-handle" ref={navHandle} aria-label="打开主导航" title="打开主导航" aria-expanded={navOpen} aria-controls="viewer-nav-panel" onClick={() => setNavOpen(true)}><ViewerIcon name="right" /></button>
        <div id="viewer-nav-panel" className="viewer-nav-panel" hidden={!navOpen}>
          <div className="viewer-nav-heading"><ViewerIcon name="layout"/><strong>平台导航</strong><button type="button" aria-label="收起主导航" onClick={closeNav}><ViewerIcon name="left"/></button></div>
          {menu}
        </div>
      </nav> : <Sider width={184} theme="light"><div className="app-brand">医学影像标注平台</div>{menu}</Sider>}
      <Layout>
        <Header className="app-header">
          <span className="app-header-title">{viewing ? '医学影像标注平台' : items.find(item => location.pathname.startsWith(item.key))?.label ?? '医学影像标注平台'}</span>
          <Typography.Text>{session.role === 'admin' ? '管理员' : session.role === 'student' ? '学生' : '业务人员'}</Typography.Text>
          <Button onClick={onLogout}>退出登录</Button>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
