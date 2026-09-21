import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedRequest } from './auth.models';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  it('rejects a member before an account-management handler runs', () => {
    const request: AuthenticatedRequest = {
      headers: {},
      user: {
        id: 'member-1', username: 'member', password_hash: 'unused', real_name: '合成人员',
        role: 'member', quals: {}, status: 'active', expire_at: '2099-12-31',
        must_change_password: false, mfa_secret_encrypted: null, updated_at: new Date(),
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    expect(() => new AdminGuard().canActivate(context as never)).toThrow(ForbiddenException);
  });
});
