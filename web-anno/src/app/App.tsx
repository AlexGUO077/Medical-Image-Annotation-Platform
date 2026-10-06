import { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { allowAccountDrafts, clearAccountDrafts, draftAccountId } from '../annotations/drafts';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

import type { Session } from '../auth/types';
import { LoginPage } from '../pages/LoginPage';
import { AdminTaxonomyPage } from '../pages/AdminTaxonomyPage';
import { CaseImportPage } from '../pages/CaseImportPage';
import { CaseClinicalPage } from '../pages/CaseClinicalPage';
import { WorkbenchPage } from '../pages/WorkbenchPage';
import { TasksPage } from '../pages/TasksPage';
import { LibraryPage } from '../pages/LibraryPage';
import { LibraryCasePage } from '../pages/LibraryCasePage';
import { ReviewPage } from '../pages/ReviewPage';
import { ModulePlaceholderPage } from '../pages/ModulePlaceholderPage';
import { AppErrorBoundary } from './AppErrorBoundary';
import { AuthenticatedLayout } from './AuthenticatedLayout';
import { appRoutes } from './routes';
import { ThemeBoundary } from './theme/ThemeBoundary';

interface AppProps {
  initialEntries?: string[];
  initialSession?: Session;
}

function AppRoutes({ initialSession }: { initialSession?: Session }) {
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const [cleanupFailed, setCleanupFailed] = useState<string>();
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const clearDrafts = (accountId: string) => {
    cleanup.current = clearAccountDrafts(accountId).then(() => setCleanupFailed(undefined), () => setCleanupFailed(accountId));
  };
  const logout = () => {
    const accountId = session && draftAccountId(session.token);
    if (accountId) clearDrafts(accountId);
    setSession(null);
  };
  const authenticated = async (next: Session) => {
    await cleanup.current;
    const accountId = draftAccountId(next.token);
    if (accountId) allowAccountDrafts(accountId);
    setSession(next);
  };
  return (
    <ThemeBoundary>
      {cleanupFailed && <Alert type="error" message="上次退出时，本机标注草稿清理失败" action={<Button onClick={() => { if (session && draftAccountId(session.token) === cleanupFailed) setSession(null); clearDrafts(cleanupFailed); }}>重试清理（当前账号会退出）</Button>} />}
      <Routes>
        <Route path="/login" element={session
          ? <Navigate replace to="/tasks" />
          : <LoginPage onAuthenticated={authenticated} />} />
        {appRoutes.filter((route) => route.path !== '/login').map((route) => (
          <Route key={route.path} path={route.path} element={session
            ? (
              ['/admin', '/cases/import', '/cases/:id'].includes(route.path) && session.role !== 'admin'
                ? <Navigate replace to="/tasks" />
                : (
                  <AuthenticatedLayout session={session} onLogout={logout}>
                    {route.path === '/workbench/:caseId'
                      ? <WorkbenchPage key={session.token} session={session} onExpired={() => setSession(null)} />
                      : route.path === '/review/:caseId'
                      ? <ReviewPage key={session.token} session={session} onExpired={() => setSession(null)} />
                      : route.path === '/library'
                      ? <LibraryPage session={session} onExpired={logout} />
                      : route.path === '/library/:caseId'
                      ? <LibraryCasePage session={session} onExpired={logout} />
                      : route.path === '/tasks'
                      ? <TasksPage session={session} />
                      : route.path === '/admin'
                      ? <AdminTaxonomyPage session={session} />
                      : route.path === '/cases/import'
                        ? <CaseImportPage session={session} />
                        : route.path === '/cases/:id'
                          ? <CaseClinicalPage session={session} />
                        : <ModulePlaceholderPage title={route.label} />}
                  </AuthenticatedLayout>
                )
            )
            : <Navigate replace to="/login" />} />
        ))}
        <Route path="*" element={<Navigate replace to={session ? '/tasks' : '/login'} />} />
      </Routes>
    </ThemeBoundary>
  );
}

export function App({ initialEntries, initialSession }: AppProps) {
  const router = initialEntries ? (
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={initialEntries}
    >
      <AppRoutes initialSession={initialSession} />
    </MemoryRouter>
  ) : (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppRoutes initialSession={initialSession} />
    </BrowserRouter>
  );

  return <AppErrorBoundary>{router}</AppErrorBoundary>;
}
