import { ConflictException, NotFoundException } from '@nestjs/common';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CasesClinicalService } from './cases-clinical.service';
const id = '00000000-0000-4000-8000-000000000001';
const actor = { id } as never;
const body = { clinical_text: '患者：张三，45岁', age_band: '40–49', sex: '男', confirm_method: '临床综合诊断' };
function setup() {
  const query = vi.fn().mockResolvedValue([{ status: '已录入', source: 'synthetic' }]);
  const manager = { query: vi.fn().mockResolvedValue([{ status: '已录入', source: 'synthetic' }]) };
  const db = { query, transaction: vi.fn(async (fn) => fn(manager)) };
  const worker = { processText: vi.fn(async (_input, output) => {
    await writeFile(join(output, 'mask-map.json'), '[]');
    return { fields: ['患者：某，45岁', '40–49', '男'], masked_count: 1 };
  }) };
  const maps = { storeFromFile: vi.fn().mockResolvedValue(id), remove: vi.fn() };
  return { service: new CasesClinicalService(db as never, worker as never, maps as never, { reserve: vi.fn().mockResolvedValue("intent"), complete: vi.fn().mockResolvedValue(undefined), compensate: vi.fn(async () => maps.remove(id)) } as never), db, manager, worker, maps };
}
describe('clinical and teaching updates', () => {
  it('only persists server-masked values and records safe counts', async () => {
    const h = setup();
    expect(await h.service.save(id, actor, body, false, 'local')).toMatchObject({ clinical_text: '患者：某，45岁', masked_count: 1 });
    expect(JSON.stringify(h.manager.query.mock.calls)).not.toContain('张三');
    expect(h.manager.query.mock.calls[1]![1]).toEqual([id, '患者：某，45岁', '40–49', '男', body.confirm_method]);
    expect(h.maps.remove).not.toHaveBeenCalled();
    await expect(access(h.worker.processText.mock.calls[0]![0])).rejects.toThrow();
  });
  it('does not write if NER fails', async () => {
    const h = setup(); h.worker.processText.mockRejectedValueOnce(new Error('NER unavailable'));
    await expect(h.service.save(id, actor, body, false, 'local')).rejects.toThrow();
    expect(h.db.transaction).not.toHaveBeenCalled();
  });
  it('rechecks state under the transaction lock and compensates the mapping', async () => {
    const h = setup(); h.manager.query.mockResolvedValueOnce([{ status: '已发布', source: 'synthetic' }]);
    await expect(h.service.save(id, actor, body, false, 'local')).rejects.toBeInstanceOf(ConflictException);
    expect(h.manager.query).toHaveBeenCalledTimes(1);
    expect(h.maps.remove).toHaveBeenCalledWith(id);
  });
  it('rejects deleted cases and unapproved sources before running NER', async () => {
    const h = setup(); h.db.query.mockResolvedValueOnce([]);
    await expect(h.service.save(id, actor, body, false, 'local')).rejects.toBeInstanceOf(NotFoundException);
    h.db.query.mockResolvedValueOnce([{ status: '已录入', source: 'unapproved' }]);
    await expect(h.service.save(id, actor, body, false, 'local')).rejects.toBeInstanceOf(ConflictException);
    expect(h.worker.processText).not.toHaveBeenCalled();
  });
  it('limits teaching arrays and masks each field before saving JSON', async () => {
    const h = setup();
    await expect(h.service.save(id, actor, { difficulty: '', applicable_level: '', sign_points: Array(51).fill('a') }, true, 'local')).rejects.toThrow();
    h.worker.processText.mockResolvedValueOnce({ fields: ['简单', '某', '安全要点'], masked_count: 1 });
    const result = await h.service.save(id, actor, { difficulty: '简单', applicable_level: '张三', sign_points: ['安全要点'] }, true, 'local');
    expect(result).toMatchObject({ applicable_level: '某', sign_points: ['安全要点'] });
    expect(JSON.stringify(h.manager.query.mock.calls)).not.toContain('张三');
  });
});
