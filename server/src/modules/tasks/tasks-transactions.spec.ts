import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { TasksService } from './tasks.service';
const id = '00000000-0000-4000-8000-000000000002';
const actor = { id: '00000000-0000-4000-8000-000000000001', role: 'admin', status: 'active', expire_at: '2099-12-31', must_change_password: false, mfa_secret_encrypted: 'synthetic', updated_at: new Date('2026-01-01') } as AuthUser;
const body = { name: '  合成任务  ', source: 'synthetic', system_code: 'resp', review_mode: 'peer', priority: 2, dispatch_mode: 'manual', case_ids: [id] };
function setup() {
  const query = vi.fn();
  const db = { transaction: vi.fn(async (...args: unknown[]) => (args.at(-1) as (m: unknown) => unknown)({ query })) };
  return { query, db, service: new TasksService(db as never) };
}
function creation() {
  const s = setup();
  s.query.mockResolvedValueOnce([actor]).mockResolvedValueOnce([{ id, source: 'synthetic', system_code: 'resp', status: '已录入' }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([{ target: `cases:${id}` }]).mockResolvedValueOnce([{ id: 'task' }]).mockResolvedValue([]);
  return s;
}
describe('task transactional decisions and paginated reads', () => {
  it('creates only confirmed cases, preserving explicit dispatch configuration', async () => {
    const s = creation();
    expect(await s.service.create(actor, body, 'local')).toMatchObject({ id: 'task', name: '合成任务', dispatch_mode: 'manual', status: '进行中', case_ids: [id] });
    const audit = s.query.mock.calls.find(call => call[0].includes('INSERT INTO "audit_logs"'))!;
    expect(JSON.parse(audit[1][2])).toMatchObject({ from: '已录入', to: '待分配', case_ids: [id] });
  });
  it.each([
    [[], 401], [[{ ...actor, updated_at: new Date('2026-01-02') }], 401],
    [[{ ...actor, status: 'disabled' }], 403], [[{ ...actor, role: 'member' }], 403],
    [[{ ...actor, expire_at: '2000-01-01' }], 403], [[{ ...actor, must_change_password: true }], 403], [[{ ...actor, mfa_secret_encrypted: null }], 403],
  ])('revalidates administrator before writing %j', async (users, status) => {
    const s = setup(); s.query.mockResolvedValueOnce(users);
    await expect(s.service.create(actor, body, 'local')).rejects.toMatchObject({ status });
    expect(s.query).toHaveBeenCalledTimes(1);
  });
  it.each([
    { cases: [], assigned: [], confirmed: [], status: 404 },
    { cases: [{ id, source: 'synthetic', system_code: 'bone', status: '已录入' }], assigned: [], confirmed: [], status: 409 },
    { cases: [{ id, source: 'synthetic', system_code: 'resp', status: '已录入' }], assigned: [{ id }], confirmed: [], status: 409 },
    { cases: [{ id, source: 'synthetic', system_code: 'resp', status: '已录入' }], assigned: [], confirmed: [], status: 409 },
  ])('denies missing, wrong-scope, already-linked or unconfirmed cases', async scenario => {
    const s = setup(); s.query.mockResolvedValueOnce([actor]).mockResolvedValueOnce(scenario.cases).mockResolvedValueOnce(scenario.assigned).mockResolvedValueOnce(scenario.confirmed);
    await expect(s.service.create(actor, body, 'local')).rejects.toMatchObject({ status: scenario.status });
    expect(s.query.mock.calls.some(call => call[0].startsWith('INSERT'))).toBe(false);
  });
  it('does not report creation success if the audit write fails', async () => {
    const s = creation();
    s.query.mockImplementation(async sql => { if (sql.includes('INSERT INTO "audit_logs"')) throw new Error('audit unavailable'); return []; });
    await expect(s.service.create(actor, body, 'local')).rejects.toThrow('audit unavailable');
  });
  it.each(['list', 'eligibleCases', 'cases'] as const)('returns bounded page data for %s', async method => {
    const s = setup();
    if (method === 'cases') s.query.mockResolvedValueOnce([{ id }]);
    s.query.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([{ total: 23 }]);
    const query = { page: '2', pageSize: '10', source: 'synthetic', system_code: 'resp' };
    const result = method === 'cases' ? await s.service.cases(actor, id, query) : await s.service[method](actor, query);
    expect(result).toEqual({ items: [{ id }], total: 23, page: 2, pageSize: 10 });
    expect(s.db.transaction.mock.calls[0]?.[0]).toBe('REPEATABLE READ');
    const read = s.query.mock.calls.find(call => call[0].includes('LIMIT'))!;
    expect(read[1].slice(-2)).toEqual([10, 10]);
  });
  it.each([{ page: '0' }, { pageSize: '101' }, { page: '9007199254740991', pageSize: '100' }, { source: 'real' }, { system_code: 'unknown' }])('rejects invalid list bounds/scope %j', async query => {
    const s = setup(); await expect(s.service.list(actor, query)).rejects.toMatchObject({ status: 400 });
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
  it('requires eligible-case scope, valid task ID, existing task and administrator access', async () => {
    const s = setup();
    await expect(s.service.eligibleCases(actor, {})).rejects.toMatchObject({ status: 400 });
    await expect(s.service.cases(actor, 'bad', {})).rejects.toMatchObject({ status: 400 });
    await expect(s.service.list({ ...actor, role: 'member' }, {})).rejects.toMatchObject({ status: 403 });
    s.query.mockResolvedValueOnce([]);
    await expect(s.service.cases(actor, id, {})).rejects.toMatchObject({ status: 404 });
  });
});
