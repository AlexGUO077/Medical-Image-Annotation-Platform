import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../database/password';
import type { AuthUser } from './auth.models';
import { AuthService } from './auth.service';

function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001', username: 'member',
    password_hash: hashPassword('Synthetic-Password-1', Buffer.alloc(16, 1)),
    real_name: '合成人员', role: 'member', quals: { resp: ['annotate'] }, status: 'active',
    expire_at: '2099-12-31', must_change_password: false, mfa_secret_encrypted: null,
    updated_at: new Date('2026-09-20T00:00:00Z'), ...overrides,
  };
}

function serviceFor(user: AuthUser | undefined) {
  const dataSource = { query: vi.fn().mockResolvedValue(user ? [user] : []) };
  const tokens = {
    signAccess: vi.fn().mockReturnValue('access-token'),
    signChallenge: vi.fn().mockImplementation((_user, purpose) => `${purpose}-token`),
  };
  const security = {
    assertAttemptAllowed: vi.fn(), clearAttempts: vi.fn(), consumeTotp: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const service = new AuthService(
    dataSource as never,
    tokens as never,
    {} as never,
    security as never,
    audit as never,
  );
  return { service, tokens, security, audit };
}

describe('AuthService login', () => {
  it('issues an access token to an active member', async () => {
    const { service, audit } = serviceFor(createUser());
    const response = await service.login({ username: 'member', password: 'Synthetic-Password-1' }, '127.0.0.1');

    expect(response).toMatchObject({ token: 'access-token', next: 'authenticated', role: 'member' });
    expect(audit.record).toHaveBeenCalledWith(expect.any(String), 'auth.login', expect.any(String), expect.any(Object), '127.0.0.1');
  });

  it('does not issue a full token before first password change', async () => {
    const { service, tokens } = serviceFor(createUser({ must_change_password: true }));
    const response = await service.login({ username: 'member', password: 'Synthetic-Password-1' }, '127.0.0.1');

    expect(response.next).toBe('change_password');
    expect(tokens.signChallenge).toHaveBeenCalledWith(expect.any(Object), 'password_change');
  });

  it('requires TOTP verification for an enrolled administrator', async () => {
    const { service } = serviceFor(createUser({ role: 'admin', mfa_secret_encrypted: 'encrypted' }));
    const response = await service.login({ username: 'member', password: 'Synthetic-Password-1' }, '127.0.0.1');

    expect(response).toMatchObject({ token: 'mfa_verify-token', next: 'verify_2fa', role: 'admin' });
  });

  it.each([
    [undefined, 'Synthetic-Password-1'],
    [createUser(), 'wrong-password'],
    [createUser({ status: 'disabled' }), 'Synthetic-Password-1'],
  ])('uses the same error for unknown, invalid, and disabled accounts', async (user, password) => {
    const { service } = serviceFor(user);
    await expect(service.login({ username: 'member', password }, '127.0.0.1'))
      .rejects.toEqual(expect.objectContaining<Partial<UnauthorizedException>>({ message: '用户名或密码错误' }));
  });
});
