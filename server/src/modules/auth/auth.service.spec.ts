import { HttpException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../database/password';
import type { AuthUser } from './auth.models';
import { AuthService } from './auth.service';

const replacementPassword = `Synthetic-${randomBytes(12).toString('hex')}`;

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
  const write = vi.fn().mockResolvedValue([]);
  const dataSource = { query: vi.fn().mockResolvedValue(user ? [user] : []), transaction: vi.fn(async (work: (m: unknown) => unknown) => work({ query: write })) };
  const tokens = {
    signAccess: vi.fn().mockReturnValue('access-token'),
    signChallenge: vi.fn().mockImplementation((_user, purpose) => `${purpose}-token`),
    verify: vi.fn().mockReturnValue({ sub: user?.id, purpose: 'mfa_verify' }),
  };
  const security = {
    assertAttemptAllowed: vi.fn(), clearAttempts: vi.fn(), consumeTotp: vi.fn().mockResolvedValue(true),
  };
  const totp = { verify: vi.fn().mockResolvedValue(123), createSetup: vi.fn().mockResolvedValue({ encryptedSecret: 'synthetic-encrypted', qrCodeDataUrl: 'synthetic-qr', manualKey: 'synthetic-manual' }) };
  const audit = { record: vi.fn() };
  const service = new AuthService(
    dataSource as never,
    tokens as never,
    totp as never,
    security as never,
    audit as never,
  );
  return { service, tokens, totp, security, audit, dataSource, write };
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

describe('password change and administrator enrollment', () => {
  it.each(['member', 'admin'] as const)('changes a %s password with transactional audit before issuing the next step', async role => {
    const current = createUser({ role, must_change_password: true }); const s = serviceFor(current);
    s.tokens.verify.mockReturnValue({ sub: current.id, purpose: 'password_change' });
    const result = await s.service.changePassword('Bearer synthetic-challenge', { current_password: 'Synthetic-Password-1', new_password: replacementPassword }, 'local');
    expect(result.next).toBe(role === 'admin' ? 'setup_2fa' : 'authenticated');
    const saved = s.write.mock.calls[0]![1][0];
    expect(saved).not.toContain('Synthetic-Replacement');
    expect(s.write.mock.calls[1]![0]).toContain('auth.password_changed');
    expect(s.security.clearAttempts).toHaveBeenCalledWith('password', `change:${current.id}`);
  });
  it('requires 2FA again after an enrolled administrator changes the password', async () => {
    const s = serviceFor(createUser({ role: 'admin', mfa_secret_encrypted: 'encrypted' }));
    expect((await s.service.changePassword('Bearer synthetic-access', { current_password: 'Synthetic-Password-1', new_password: replacementPassword }, 'local')).next).toBe('verify_2fa');
  });
  it.each(['wrong-current', 'same', 'short', 'letters', 'digits', 'long'] as const)('denies password change for %s without updating credentials', async kind => {
    const s = serviceFor(createUser());
    const next = { 'wrong-current': replacementPassword, same: 'Synthetic-Password-1', short: 'Aa1', letters: 'ABCDEFGHIJKLM', digits: '1234567890123', long: 'A1'.repeat(65) }[kind];
    await expect(s.service.changePassword('Bearer synthetic-access', { current_password: kind === 'wrong-current' ? 'wrong' : 'Synthetic-Password-1', new_password: next }, 'local')).rejects.toMatchObject({ status: 401 });
    expect(s.write).not.toHaveBeenCalled(); expect(s.audit.record).toHaveBeenCalled();
    expect(s.tokens.signAccess).not.toHaveBeenCalled();
  });
  it('does not issue tokens if the password audit fails', async () => {
    const s = serviceFor(createUser()); s.write.mockRejectedValue(new Error('database unavailable'));
    await expect(s.service.changePassword('Bearer synthetic-access', { current_password: 'Synthetic-Password-1', new_password: replacementPassword }, 'local')).rejects.toThrow('database unavailable');
    expect(s.tokens.signAccess).not.toHaveBeenCalled();
  });
  it('creates an enrollment challenge without persisting the unverified secret', async () => {
    const current = createUser({ role: 'admin' }); const s = serviceFor(current);
    s.tokens.verify.mockReturnValue({ sub: current.id, purpose: 'mfa_setup' });
    expect(await s.service.setupMfa('Bearer synthetic-setup')).toEqual({ token: 'mfa_enroll-token', qr_code_data_url: 'synthetic-qr', manual_key: 'synthetic-manual' });
    expect(s.write).not.toHaveBeenCalled(); expect(s.tokens.signAccess).not.toHaveBeenCalled();
  });
  it.each([{ role: 'member' }, { role: 'admin', must_change_password: true }, { role: 'admin', mfa_secret_encrypted: 'already-enrolled' }] as Partial<AuthUser>[])('refuses enrollment for incompatible account state', async overrides => {
    const s = serviceFor(createUser(overrides)); await expect(s.service.setupMfa('Bearer challenge')).rejects.toMatchObject({ status: 401 });
    expect(s.totp.createSetup).not.toHaveBeenCalled();
  });
  it('persists a verified enrollment once and reloads the user before issuing access', async () => {
    const current = createUser({ role: 'admin' }); const s = serviceFor(current);
    s.tokens.verify.mockReturnValue({ sub: current.id, purpose: 'mfa_enroll', mfa_secret_encrypted: 'synthetic-encrypted' } as never);
    expect((await s.service.verifyMfa('Bearer enrollment', { code: ' 123456 ' }, 'local')).next).toBe('authenticated');
    expect(s.totp.verify).toHaveBeenCalledWith('synthetic-encrypted', '123456');
    expect(s.security.consumeTotp).toHaveBeenCalledWith(current.id, 123);
    expect(s.write.mock.calls[0]![1]).toEqual(['synthetic-encrypted', current.id]);
    expect(s.dataSource.query).toHaveBeenCalledTimes(2);
  });
  it('rejects replay and invalid enrollment state without access tokens', async () => {
    const current = createUser({ role: 'admin', mfa_secret_encrypted: 'encrypted' }); const s = serviceFor(current);
    s.security.consumeTotp.mockResolvedValue(false);
    await expect(s.service.verifyMfa('Bearer verification', { code: '123456' }, 'local')).rejects.toThrow('动态验证码已使用');
    s.tokens.verify.mockReturnValue({ sub: current.id, purpose: 'mfa_enroll' });
    await expect(s.service.verifyMfa('Bearer enrollment', { code: '123456' }, 'local')).rejects.toThrow('双因素认证已经绑定');
    expect(s.tokens.signAccess).not.toHaveBeenCalled();
  });
  it('audits successful existing-factor login without leaking the factor', async () => {
    const s = serviceFor(createUser({ role: 'admin', mfa_secret_encrypted: 'synthetic-encrypted' }));
    expect((await s.service.verifyMfa('Bearer verification', { code: '123456' }, 'local')).next).toBe('authenticated');
    expect(JSON.stringify(s.audit.record.mock.calls)).not.toMatch(/123456|synthetic-encrypted/);
    expect(s.write).not.toHaveBeenCalled();
  });
  it('fails closed on malformed bodies, missing authorization, absent and expired users', async () => {
    const s = serviceFor(createUser({ role: 'admin', mfa_secret_encrypted: 'encrypted' }));
    for (const input of [null, {}, { username: 1, password: 2 }]) await expect(s.service.login(input, 'local')).rejects.toMatchObject({ status: 401 });
    await expect(s.service.changePassword(undefined, {}, 'local')).rejects.toMatchObject({ status: 401 });
    for (const body of [null, {}, { new_password: 123 }]) await expect(s.service.changePassword('Bearer token', body, 'local')).rejects.toMatchObject({ status: 401 });
    await expect(s.service.verifyMfa('Bearer token', {}, 'local')).rejects.toMatchObject({ status: 401 });
    await expect(serviceFor(undefined).service.requireUsableUser('missing')).rejects.toMatchObject({ status: 401 });
    await expect(serviceFor(createUser({ expire_at: '2000-01-01' })).service.requireUsableUser('expired')).rejects.toMatchObject({ status: 401 });
  });
});
