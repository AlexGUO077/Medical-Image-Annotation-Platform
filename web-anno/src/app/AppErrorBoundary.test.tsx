import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from './AppErrorBoundary';

function ThrowingComponent(): ReactElement {
  throw new Error('token should not be disclosed');
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a non-sensitive recovery message when rendering fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <ThrowingComponent />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面暂时无法显示，请刷新后重试');
    expect(screen.queryByText(/stack|token|password/i)).not.toBeInTheDocument();
  });
});
