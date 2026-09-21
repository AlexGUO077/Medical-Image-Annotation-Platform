import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TaxonomyController } from './taxonomy.controller';

describe('TaxonomyController guards', () => {
  it('requires access authentication for the entire controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TaxonomyController) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  it.each([
    'listSignTags',
    'createNode',
    'updateNode',
    'deleteNode',
    'createSignTag',
    'updateSignTag',
    'deleteSignTag',
  ] as const)('requires server-side admin authorization for %s', (method) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TaxonomyController.prototype[method]) as unknown[];
    expect(guards).toContain(AdminGuard);
  });
});
