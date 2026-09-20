import { useState } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

import type { Session } from '../auth/types';
import { LoginPage } from '../pages/LoginPage';
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
  return (
    <ThemeBoundary>
      <Routes>
        <Route path="/login" element={session
          ? <Navigate replace to="/tasks" />
          : <LoginPage onAuthenticated={setSession} />} />
        {appRoutes.filter((route) => route.path !== '/login').map((route) => (
          <Route key={route.path} path={route.path} element={session
            ? (
              <AuthenticatedLayout session={session} onLogout={() => setSession(null)}>
                <ModulePlaceholderPage title={route.label} />
              </AuthenticatedLayout>
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
