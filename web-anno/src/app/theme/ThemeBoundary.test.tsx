import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ThemeBoundary } from './ThemeBoundary';

describe('ThemeBoundary', () => {
  it.each([
    ['/login', 'light'],
    ['/tasks', 'light'],
    ['/cases/import', 'light'],
    ['/cases/synthetic-case', 'light'],
    ['/library', 'light'],
    ['/dashboard', 'light'],
    ['/admin', 'light'],
    ['/workbench/synthetic-case', 'dark'],
    ['/review/synthetic-case', 'dark'],
  ])('uses the %s theme on %s', (path, expectedTheme) => {
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[path]}
      >
        <ThemeBoundary>
          <p>shell content</p>
        </ThemeBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', expectedTheme);
  });
});
