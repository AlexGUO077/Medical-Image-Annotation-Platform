import type { AuthResponse } from './types';

interface MfaSetupResponse {
  token: string;
  qr_code_data_url: string;
  manual_key: string;
}

async function request<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? '请求失败，请稍后重试');
  return payload;
}

export const authApi = {
  login(username: string, password: string) {
    return request<AuthResponse>('/auth/login', { username, password });
  },
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return request<AuthResponse>('/auth/password', {
      current_password: currentPassword,
      new_password: newPassword,
    }, token);
  },
  setupMfa(token: string) {
    return request<MfaSetupResponse>('/auth/2fa/setup', {}, token);
  },
  verifyMfa(token: string, code: string) {
    return request<AuthResponse>('/auth/2fa/verify', { code }, token);
  },
};
