import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { UsersService } from './users.service';

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  password_hash: 'unused',
  real_name: '合成管理员',
  role: 'admin',
  quals: {},
  status: 'active',
  expire_at: '2099-12-31',
  must_change_password: false,
  mfa_secret_encrypted: 'encrypted',
  updated_at: new Date('2026-09-20T00:00:00Z'),
};

function serviceWithTarget(overrides: Record<string, unknown> = {}) {
  const target = {
    id: admin.id,
    role: 'admin',
    status: 'active',
    quals: {},
    expire_at: '2099-12-31',
    mfa_secret_encrypted: 'encrypted',
    ...overrides,
  };
  const dataSource = {
    query: vi.fn().mockResolvedValue([target]),
    transaction: vi.fn(),
  };
  return { service: new UsersService(dataSource as never), dataSource };
}

describe('UsersService validation', () => {
  it('rejects qualifications outside the eight systems and approved capabilities', async () => {
    const { service, dataSource } = serviceWithTarget();

    await expect(service.create(admin, {
      real_name: '合成成员',
      role: 'member',
      quals: { resp: ['download'] },
      expire_at: '2099-12-31',
    }, '127.0.0.1')).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects page sizes above 100 before querying the database', async () => {
    const { service, dataSource } = serviceWithTarget();

    await expect(service.list('1', '101')).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('prevents an administrator from resetting their own MFA', async () => {
    const { service, dataSource } = serviceWithTarget();

    await expect(service.update(admin, { id: admin.id, reset_mfa: true }, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('prevents an administrator from disabling their own account', async () => {
    const { service, dataSource } = serviceWithTarget();

    await expect(service.update(admin, { id: admin.id, status: 'disabled' }, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
