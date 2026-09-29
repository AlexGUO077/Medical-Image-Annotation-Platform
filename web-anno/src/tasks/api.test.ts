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
});
