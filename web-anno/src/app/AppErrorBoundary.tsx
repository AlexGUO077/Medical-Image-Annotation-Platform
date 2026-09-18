import { Alert } from 'antd';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Deliberately do not render or disclose error details.
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return <Alert type="error" message="页面暂时无法显示，请刷新后重试" role="alert" />;
    }

    return this.props.children;
  }
}
