import { afterEach, describe, expect, it, vi } from 'vitest';
import { tasksApi } from './api';
import { syntheticCase, syntheticTask } from './fixtures';
afterEach(() => vi.restoreAllMocks());
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
describe('tasks API', () => {
  it('uses bearer auth and no-store for filtered paginated reads', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [syntheticTask], total: 1, page: 1, pageSize: 20 }));
    expect((await tasksApi.list('token', { page: 1, source: 'synthetic' })).items[0]).toEqual(syntheticTask);
    expect(fetch).toHaveBeenCalledWith('/api/tasks?page=1&source=synthetic', expect.objectContaining({ cache: 'no-store', headers: { Authorization: 'Bearer token' } }));
  });
  it('keeps candidate scope in the query and supports cancellation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ items: [syntheticCase], total: 1, page: 1, pageSize: 20 }));
    const controller = new AbortController();
    await tasksApi.eligible('token', { source: 'synthetic', system_code: 'resp' }, controller.signal);
    expect(fetch).toHaveBeenCalledWith('/api/tasks/eligible-cases?source=synthetic&system_code=resp', expect.objectContaining({ signal: controller.signal }));
  });
  it('sends only selected task input and propagates creation conflicts', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ message: '病例已属于其他任务' }, 409));
    const input = { name: '合成', source: 'synthetic' as const, system_code: 'resp' as const, review_mode: 'peer' as const, priority: 0, case_ids: [syntheticCase.id] };
    await expect(tasksApi.create('token', input)).rejects.toThrow('病例已属于其他任务');
    expect(fetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }));
  });
  it('uses authenticated paginated user reads and preserves nullable settings in writes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({}));
    const controller = new AbortController();
    await tasksApi.assignees('token', 2, controller.signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/users?page=2&pageSize=20', expect.objectContaining({ signal: controller.signal, cache: 'no-store', headers: { Authorization: 'Bearer token' } }));
    await tasksApi.settings('token', syntheticTask.id, { priority: -2, in_flight_limit: null });
    expect(fetch).toHaveBeenLastCalledWith(`/api/tasks/${syntheticTask.id}/settings`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ priority: -2, in_flight_limit: null }) }));
    await tasksApi.personLimit('token', 'person', null);
    expect(fetch).toHaveBeenLastCalledWith('/api/tasks/assignees/person/limit', expect.objectContaining({ method: 'PATCH', body: '{"in_flight_limit":null}' }));
    const input = { mode: 'manual' as const, task_id: syntheticTask.id, assignee_id: 'person', case_ids: [syntheticCase.id], due_at: null };
    await tasksApi.dispatch('token', input);
    expect(fetch).toHaveBeenLastCalledWith('/api/tasks/dispatch', expect.objectContaining({ method: 'POST', body: JSON.stringify(input), headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }));
  });

});
