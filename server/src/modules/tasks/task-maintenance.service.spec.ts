import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, BadRequestException } from '@nestjs/common';
import { TaskMaintenanceService } from './task-maintenance.service';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function fixture() {
  const query = vi.fn().mockResolvedValue([]);
  const maintainAutomatic = vi.fn().mockResolvedValue({ next_case_id: null });
  const service = new TaskMaintenanceService({ query } as never, { maintainAutomatic } as never);
  return { query, maintainAutomatic, service };
}
describe('TaskMaintenanceService lifecycle', () => {
  it('starts at bootstrap, schedules only after completion, and cancels on shutdown', async () => {
    vi.useFakeTimers();
    const { service, query } = fixture();
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent passes and shutdown waits for the transaction', async () => {
    const { service, maintainAutomatic } = fixture();
    let complete!: (value: { next_case_id: null }) => void;
    maintainAutomatic.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const first = service.runOnce(), second = service.runOnce();
    expect(second).toBe(first);
    await Promise.resolve();
    let stopped = false;
    const stop = service.onModuleDestroy().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    complete({ next_case_id: null });
    await stop; expect(stopped).toBe(true);
    await service.runOnce(); expect(maintainAutomatic).toHaveBeenCalledTimes(1);
  });
  it('retries failed passes without logging database or patient details', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, query, maintainAutomatic } = fixture();
    query.mockRejectedValueOnce(new Error('synthetic sensitive detail'));
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(2); expect(maintainAutomatic).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive');
    await service.onModuleDestroy();
  });
  it('continues automatic batches and resets a cursor invalidated by a mode change', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, maintainAutomatic } = fixture();
    maintainAutomatic.mockResolvedValueOnce({ next_case_id: 'case-cursor' }).mockRejectedValueOnce(new BadRequestException());
    await service.runOnce(); await service.runOnce(); await service.runOnce();
    expect(maintainAutomatic.mock.calls).toEqual([[undefined], ['case-cursor'], [undefined]]);
    await service.onModuleDestroy();
  });
});
