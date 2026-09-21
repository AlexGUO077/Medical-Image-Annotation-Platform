import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CasesController } from './cases.controller';

describe('CasesController guards', () => {
  it('requires authenticated admin authorization for all import and mapping routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, CasesController) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
    expect(guards).toContain(AdminGuard);
  });
});
