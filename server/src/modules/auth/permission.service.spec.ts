import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth.models';
import { PermissionService } from './permission.service';

const user: AuthUser = {
  id: 'user-1', username: 'member', password_hash: 'unused', real_name: '合成人员',
  role: 'member', quals: { resp: ['annotate'] }, status: 'active', expire_at: '2099-12-31',
  must_change_password: false, mfa_secret_encrypted: null, updated_at: new Date(),
};

describe('PermissionService', () => {
  it('rejects a missing qualification before querying assignment or resource', async () => {
    const query = vi.fn();
    const service = new PermissionService({ query } as never);

    await expect(service.assertCaseAssignment(user, 'case-1', 'bone', 'annotate'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('checks assignment before resource existence', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const service = new PermissionService({ query } as never);

    await expect(service.assertCaseAssignment(user, 'case-1', 'resp', 'annotate'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns not found only after qualification and assignment pass', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 'assignment-1' }]).mockResolvedValueOnce([]);
    const service = new PermissionService({ query } as never);

    await expect(service.assertCaseAssignment(user, 'case-1', 'resp', 'annotate'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
