import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { TasksService } from './tasks.service';

const actor = { role: 'admin' } as AuthUser;
const valid = { name: '合成任务', source: 'synthetic', system_code: 'resp', review_mode: 'peer', priority: 0,
  case_ids: ['abcdefab-1234-4567-89ab-abcdefabcdef'] };

describe('task creation input boundary', () => {
  it.each([
    null, [], {}, { ...valid, name: ' ' }, { ...valid, source: 'unapproved' },
    { ...valid, system_code: 'unknown' }, { ...valid, review_mode: 'other' },
    { ...valid, priority: 0.5 }, { ...valid, priority: 2147483648 },
    { ...valid, case_ids: [] }, { ...valid, case_ids: ['not-a-uuid'] },
    { ...valid, case_ids: [valid.case_ids[0], valid.case_ids[0]?.toUpperCase()] },
    { ...valid, in_flight_limit: 5 }, { ...valid, timeout_hours: 24 },
  ])('rejects invalid or unsupported input before a transaction: %j', async (body) => {
    const db = { transaction: vi.fn() };
    await expect(new TasksService(db as never).create(actor, body, '127.0.0.1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers even outside the HTTP controller', async () => {
    const db = { transaction: vi.fn() };
    await expect(new TasksService(db as never).create({ role: 'member' } as AuthUser, valid, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
