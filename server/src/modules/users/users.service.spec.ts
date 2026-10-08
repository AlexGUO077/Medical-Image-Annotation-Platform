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

    await expect(service.list(admin, {page:'1',pageSize:'101'})).rejects.toBeInstanceOf(BadRequestException);
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

  it('rejects ambiguous pagination, unsafe offsets, extra fields and invalid calendar dates', async () => {
    const {service,dataSource}=serviceWithTarget();
    for(const query of [{page:['1','2']},{page:'01'},{page:'9007199254740991',pageSize:'100'},{role:'member'}])await expect(service.list(admin,query)).rejects.toBeInstanceOf(BadRequestException);
    for(const input of [{id:admin.id,role:'member'},{id:admin.id,reset_mfa:'true'},{id:admin.id,expire_at:'2026-02-30'}])await expect(service.update(admin,input,'synthetic')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(admin,{real_name:'合成',role:'member',expire_at:'2026-02-30'},'synthetic')).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rechecks current administrator permissions in both read and creation transactions',async()=>{
    const {service,dataSource}=serviceWithTarget();
    const query=vi.fn().mockResolvedValue([{...admin,status:'disabled'}]);dataSource.transaction.mockImplementation(async run=>run({query}));
    await expect(service.list(admin,{})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(admin,{real_name:'合成',role:'member',quals:{},expire_at:'2099-12-31'},'synthetic')).rejects.toBeInstanceOf(ForbiddenException);
    expect(query.mock.calls.every(([sql])=>sql.includes('FOR SHARE'))).toBe(true);
  });
});
