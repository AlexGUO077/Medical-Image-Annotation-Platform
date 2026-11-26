import { EducationLeaveGuard } from '../education/navigation-guard';
import { StudentActivationPage } from '../education/StudentActivationPage';
import { StudentTasksPage } from '../education/StudentTasksPage';
import { StudentWorkbenchPage } from '../education/StudentWorkbenchPage';
import { StudentAccountPage } from '../education/StudentAccountPage';
import { EducationAdminPage } from '../education/EducationAdminPage';
import { ModulePlaceholderPage } from '../pages/ModulePlaceholderPage';
import { DashboardPage } from '../pages/DashboardPage';
import { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { allowAccountDrafts, clearAccountDrafts, draftAccountId } from '../annotations/drafts';
import { createBrowserRouter, createMemoryRouter, RouterProvider, Navigate, Route, Routes } from 'react-router-dom';

import type { Session } from '../auth/types';
import { LoginPage } from '../pages/LoginPage';
import { AdminPage } from '../pages/AdminPage';
import { CaseImportPage } from '../pages/CaseImportPage';
import { CaseClinicalPage } from '../pages/CaseClinicalPage';
import { WorkbenchPage } from '../pages/WorkbenchPage';
import { TasksPage } from '../pages/TasksPage';
import { LibraryPage } from '../pages/LibraryPage';
import { LibraryCasePage } from '../pages/LibraryCasePage';
import { ReviewPage } from '../pages/ReviewPage';
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
  const leaveGuard = useRef<null|(()=>Promise<boolean>)>(null);
  const expireSession = () => {
    const accountId = session && draftAccountId(session.token);
    if (accountId) clearDrafts(accountId);
    setSession(null);
  };
  const logout = async () => { if (!leaveGuard.current || await leaveGuard.current()) expireSession(); };
  const authenticated = async (next: Session) => {
    await cleanup.current;
    const accountId = draftAccountId(next.token);
    if (accountId) allowAccountDrafts(accountId);
    setSession(next);
  };
  const home = session?.role === 'student' ? '/student' : '/tasks';
  const studentPage = (element: React.ReactNode) => !session ? <Navigate replace to="/login" /> : session.role !== 'student' ? <Navigate replace to={home} /> : <AuthenticatedLayout session={session} onLogout={logout}>{element}</AuthenticatedLayout>;
  return (
    <EducationLeaveGuard.Provider value={leaveGuard}><ThemeBoundary>
      {cleanupFailed && <Alert type="error" message="上次退出时，本机标注草稿清理失败" action={<Button onClick={() => { if (session && draftAccountId(session.token) === cleanupFailed) setSession(null); clearDrafts(cleanupFailed); }}>重试清理（当前账号会退出）</Button>} />}
      <Routes>
        <Route path="/student/activate" element={session ? <Navigate replace to={home}/> : <StudentActivationPage/>}/>
        <Route path="/student" element={studentPage(session && <StudentTasksPage session={session} onExpired={expireSession}/>)}/>
        <Route path="/student/account" element={studentPage(session && <StudentAccountPage session={session} onChanged={logout}/>)}/>
        <Route path="/student/attempts/:attemptId" element={studentPage(session && <StudentWorkbenchPage session={session} onExpired={expireSession}/>)}/>
        <Route path="/student/attempts/:attemptId/feedback" element={studentPage(session && <StudentWorkbenchPage session={session} onExpired={expireSession} feedback/>)}/>
        <Route path="/education" element={!session?<Navigate replace to="/login"/>:session.role!=='admin'?<Navigate replace to={home}/>:<AuthenticatedLayout session={session} onLogout={logout}><EducationAdminPage session={session} onExpired={logout}/></AuthenticatedLayout>}/>

        <Route path="/login" element={session
          ? <Navigate replace to={home} />
          : <LoginPage onAuthenticated={authenticated} />} />
        {appRoutes.filter((route) => route.path !== '/login').map((route) => (
          <Route key={route.path} path={route.path} element={session
            ? (
              session.role === 'student' || (['/admin', '/cases/import', '/cases/:id', '/dashboard'].includes(route.path) && session.role !== 'admin')
                ? <Navigate replace to={home} />
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
                      ? <AdminPage key={session.token} session={session} onExpired={logout} />
                      : route.path === '/cases/import'
                        ? <CaseImportPage session={session} />
                        : route.path === '/cases/:id'
                          ? <CaseClinicalPage session={session} />
                        : route.path === '/dashboard'
                          ? <DashboardPage key={session.token} session={session} onExpired={logout} />
                          : <ModulePlaceholderPage title={route.label} />}
                  </AuthenticatedLayout>
                )
            )
            : <Navigate replace to="/login" />} />
        ))}
        <Route path="*" element={<Navigate replace to={session ? home : '/login'} />} />
      </Routes>
    </ThemeBoundary></EducationLeaveGuard.Provider>
  );
}

export function App({ initialEntries, initialSession }: AppProps) {
  const [router] = useState(() => {
    const routes = [{path:'*',element:<AppRoutes initialSession={initialSession}/>}];
    return initialEntries ? createMemoryRouter(routes,{initialEntries,future:{v7_relativeSplatPath:true}}) : createBrowserRouter(routes,{future:{v7_relativeSplatPath:true}});
  });
  return <AppErrorBoundary><RouterProvider router={router} future={{v7_startTransition:true}}/></AppErrorBoundary>;
}
