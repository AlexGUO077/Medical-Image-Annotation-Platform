import { HttpException, UnauthorizedException } from '@nestjs/common';
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
    verify: vi.fn().mockReturnValue({ sub: user?.id, purpose: 'mfa_verify' }),
  };
  const security = {
    assertAttemptAllowed: vi.fn(), clearAttempts: vi.fn(), consumeTotp: vi.fn().mockResolvedValue(true),
  };
  const totp = { verify: vi.fn().mockResolvedValue(123) };
  const audit = { record: vi.fn() };
  const service = new AuthService(
    dataSource as never,
    tokens as never,
    totp as never,
    security as never,
    audit as never,
  );
  return { service, tokens, totp, security, audit };
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

  it('records a failed login for a known account without sensitive values', async () => {
    const current = createUser();
    const { service, audit } = serviceFor(current);

    await expect(service.login({ username: current.username, password: 'wrong-password' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.record).toHaveBeenCalledWith(
      current.id,
      'auth.login_failed',
      `users:${current.id}`,
      { result: 'failure', scope: 'password' },
      '127.0.0.1',
    );
  });

  it('records a rate-limit lockout for a known account', async () => {
    const current = createUser();
    const { service, security, audit } = serviceFor(current);
    security.assertAttemptAllowed.mockRejectedValue(new HttpException('尝试次数过多，请稍后重试', 429));

    await expect(service.login({ username: current.username, password: 'wrong-password' }, '127.0.0.1'))
      .rejects.toMatchObject({ status: 429 });
    expect(audit.record).toHaveBeenCalledWith(
      current.id,
      'auth.locked_out',
      `users:${current.id}`,
      { result: 'blocked', scope: 'password' },
      '127.0.0.1',
    );
  });

  it('records a failed administrator TOTP verification without the code', async () => {
    const current = createUser({ role: 'admin', mfa_secret_encrypted: 'encrypted' });
    const { service, totp, audit } = serviceFor(current);
    totp.verify.mockRejectedValue(new UnauthorizedException('动态验证码无效'));

    await expect(service.verifyMfa('Bearer challenge', { code: '123456' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.record).toHaveBeenCalledWith(
      current.id,
      'auth.mfa_failed',
      `users:${current.id}`,
      { result: 'failure', scope: 'totp' },
      '127.0.0.1',
    );
  });
});
