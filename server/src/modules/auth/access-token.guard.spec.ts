import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest, AuthUser } from './auth.models';
import { AccessTokenGuard } from './access-token.guard';

const updatedAt = new Date('2026-09-20T12:00:00.123Z');

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1', username: 'member', password_hash: 'unused', real_name: '合成人员',
    role: 'member', quals: { resp: ['annotate'] }, status: 'active', expire_at: '2099-12-31',
    must_change_password: false, mfa_secret_encrypted: null, updated_at: updatedAt,
    ...overrides,
  };
}

function setup(current: AuthUser | undefined, accountUpdatedAt = updatedAt.getTime()) {
  const request: AuthenticatedRequest = { headers: { authorization: 'Bearer access-token' } };
  const dataSource = { query: vi.fn().mockResolvedValue(current ? [current] : []) };
  const tokens = { verify: vi.fn().mockReturnValue({ sub: 'user-1', account_updated_at: accountUpdatedAt }) };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return {
    guard: new AccessTokenGuard(dataSource as never, tokens as never),
    context: context as never,
    request,
  };
}

describe('AccessTokenGuard', () => {
  it('uses the current database account as the authorization fact', async () => {
    const { guard, context, request } = setup(user());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'user-1', quals: { resp: ['annotate'] } });
  });

  it.each([
    user({ status: 'disabled' }),
    user({ expire_at: '2020-01-01' }),
    user({ role: 'admin', mfa_secret_encrypted: null }),
  ])('rejects an unusable or incomplete account', async (current) => {
    const { guard, context } = setup(current);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalidates an access token immediately after the account changes', async () => {
    const { guard, context } = setup(user(), updatedAt.getTime() - 1);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
