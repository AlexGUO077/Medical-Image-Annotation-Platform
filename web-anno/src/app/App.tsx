import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';

import { ModulePlaceholderPage } from '../pages/ModulePlaceholderPage';
import { AppErrorBoundary } from './AppErrorBoundary';
import { appRoutes } from './routes';
import { ThemeBoundary } from './theme/ThemeBoundary';

interface AppProps {
  initialEntries?: string[];
}

function AppRoutes() {
  return (
    <ThemeBoundary>
      <Routes>
        {appRoutes.map((route) => (
          <Route key={route.path} path={route.path} element={<ModulePlaceholderPage title={route.label} />} />
        ))}
        <Route path="*" element={<ModulePlaceholderPage title="页面" />} />
      </Routes>
    </ThemeBoundary>
  );
}

export function App({ initialEntries }: AppProps) {
  const router = initialEntries ? (
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={initialEntries}
    >
      <AppRoutes />
    </MemoryRouter>
  ) : (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppRoutes />
    </BrowserRouter>
  );

  return <AppErrorBoundary>{router}</AppErrorBoundary>;
}
