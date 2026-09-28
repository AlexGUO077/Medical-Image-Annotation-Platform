import { randomUUID } from 'node:crypto';
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

  it('accepts 2000 unique case IDs and rejects 2001 before the transaction', async () => {
    const db = { transaction: vi.fn().mockResolvedValue({ id: 'created' }) };
    const service = new TasksService(db as never);
    const ids = Array.from({ length: 2000 }, () => randomUUID());
    await expect(service.create(actor, { ...valid, case_ids: ids }, '127.0.0.1')).resolves.toEqual({ id: 'created' });
    db.transaction.mockClear();
    await expect(service.create(actor, { ...valid, case_ids: [...ids, randomUUID()] }, '127.0.0.1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers even outside the HTTP controller', async () => {
    const db = { transaction: vi.fn() };
    await expect(new TasksService(db as never).create({ role: 'member' } as AuthUser, valid, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each(['名', '𠮷'])('accepts a trimmed 200-character name (%s)', async (character) => {
    const db = { transaction: vi.fn().mockResolvedValue({ id: 'created' }) };
    await expect(new TasksService(db as never).create(actor, {
      ...valid, name: `  ${character.repeat(200)}  `,
    }, '127.0.0.1')).resolves.toEqual({ id: 'created' });
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it.each(['名', '𠮷'])('rejects a 201-character name before accessing the database (%s)', async (character) => {
    const db = { transaction: vi.fn() };
    await expect(new TasksService(db as never).create(actor, {
      ...valid, name: character.repeat(201),
    }, '127.0.0.1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
