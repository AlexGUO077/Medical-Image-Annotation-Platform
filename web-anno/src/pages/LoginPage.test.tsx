import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('keeps the access token in callback state after member login', async () => {
    const onAuthenticated = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        token: 'access-token', role: 'member', quals: { resp: ['annotate'] },
        must_change_password: false, next: 'authenticated',
      }),
    }));
    render(<LoginPage onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Synthetic-Password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({
      token: 'access-token', role: 'member', quals: { resp: ['annotate'] },
    }));
  });

  it('shows the same server error without exposing account existence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: '用户名或密码错误' }),
    }));
    render(<LoginPage onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'unknown' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
  });

  it('shows a useful error when an upstream proxy returns HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      headers: new Headers({ 'content-type': 'text/html' }),
    }));
    render(<LoginPage onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'member' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Synthetic-Password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('服务暂时不可用，请稍后重试')).toBeInTheDocument();
  });
});
