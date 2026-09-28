import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectCompensationService } from './object-compensation.service';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
const paths: string[] = [];
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { force: true }); });
function harness() {
  const db = { query: vi.fn().mockResolvedValue([]) };
  const objects = { remove: vi.fn(), removePages: vi.fn() };
  const maps = { remove: vi.fn() };
  return { service: new ObjectCompensationService(db as never, objects as never, maps as never), db, objects, maps };
}
describe('durable object compensation', () => {
  it('retains failed cleanup across service recreation and retries later', async () => {
    const h = harness();
    const id = await h.service.reserve('cases/synthetic/key', 2, '00000000-0000-4000-8000-000000000001');
    const path = join(IMPORT_QUARANTINE_ROOT, 'object-compensation', `${id}.json`); paths.push(path);
    h.objects.removePages.mockRejectedValueOnce(new Error('storage offline'));
    await h.service.compensate(id);
    await expect(access(path)).resolves.toBeUndefined();
    const restarted = new ObjectCompensationService(h.db as never, h.objects as never, h.maps as never);
    await restarted.compensate(id);
    expect(h.objects.removePages).toHaveBeenCalledTimes(2);
    expect(h.maps.remove).toHaveBeenCalledOnce();
    await expect(access(path)).rejects.toThrow();
  });
  it('does not remove objects referenced by an uncertain but committed transaction', async () => {
    const h = harness(); h.db.query.mockResolvedValue([{ exists: true }]);
    const id = await h.service.reserve('cases/synthetic/key', 0, '00000000-0000-4000-8000-000000000001');
    paths.push(join(IMPORT_QUARANTINE_ROOT, 'object-compensation', `${id}.json`));
    await h.service.compensate(id);
    expect(h.objects.remove).not.toHaveBeenCalled(); expect(h.maps.remove).not.toHaveBeenCalled();
  });
  it('preserves the record during a database outage without deleting formal data', async () => {
    const h = harness(); h.db.query.mockRejectedValue(new Error('DB offline'));
    const id = await h.service.reserve('cases/synthetic/key', 1);
    const path = join(IMPORT_QUARANTINE_ROOT, 'object-compensation', `${id}.json`); paths.push(path);
    await h.service.compensate(id);
    await expect(access(path)).resolves.toBeUndefined();
    expect(h.objects.removePages).not.toHaveBeenCalled();
  });
});
