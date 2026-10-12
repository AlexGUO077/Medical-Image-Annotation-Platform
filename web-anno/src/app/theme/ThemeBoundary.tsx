import { ConfigProvider } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { isDarkThemePath } from '../routes';
import { darkTheme, lightTheme, viewerCssVariables } from './tokens';

interface ThemeBoundaryProps {
  children: ReactNode;
}

export function ThemeBoundary({ children }: ThemeBoundaryProps) {
  const { pathname } = useLocation();
  const themeName = isDarkThemePath(pathname) ? 'dark' : 'light';

  return (
    <ConfigProvider theme={themeName === 'dark' ? darkTheme : lightTheme}>
      <div data-testid="theme-boundary" data-theme={themeName} style={themeName === 'dark' ? viewerCssVariables as CSSProperties : undefined}>
        {children}
      </div>
    </ConfigProvider>
  );
}
