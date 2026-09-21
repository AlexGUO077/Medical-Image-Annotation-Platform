import { InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TaxonomyService } from './taxonomy.service';

const rows = [
  { id: 'root', parent_id: null, level: 1, name: '呼吸', synonyms: [], icd: null },
  { id: 'part', parent_id: 'root', level: 2, name: '合成部位', synonyms: [], icd: null },
  { id: 'disease', parent_id: 'part', level: 3, name: '合成疾病', synonyms: ['合成别名'], icd: null },
  { id: 'subtype', parent_id: 'disease', level: 4, name: '合成分型', synonyms: [], icd: null },
];

const signTags = [
  { id: 'resp-sign', name: '合成征象', system_code: 'resp', definition: '仅用于合成验证' },
  { id: 'bone-sign', name: '其他系统征象', system_code: 'bone', definition: '仅用于合成验证' },
];

describe('TaxonomyService', () => {
  it('returns a four-level tree and attaches system signs to disease nodes', async () => {
    const dataSource = { query: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(signTags) };
    const result = await new TaxonomyService(dataSource as never).tree();

    const disease = result.tree[0]?.children[0]?.children[0];
    expect(disease).toMatchObject({
      id: 'disease',
      synonyms: ['合成别名'],
      sign_tags: [signTags[0]],
    });
    expect(disease?.children[0]?.id).toBe('subtype');
    expect(result.sign_tags).toEqual(signTags);
  });

  it('rejects broken parent-level relationships instead of returning an invalid tree', async () => {
    const invalidRows = [rows[0], { ...rows[2], parent_id: 'root' }];
    const dataSource = { query: vi.fn().mockResolvedValueOnce(invalidRows).mockResolvedValueOnce([]) };

    await expect(new TaxonomyService(dataSource as never).tree())
      .rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('rejects non-string synonym data', async () => {
    const dataSource = {
      query: vi.fn()
        .mockResolvedValueOnce([{ ...rows[0], synonyms: { unexpected: true } }])
        .mockResolvedValueOnce([]),
    };

    await expect(new TaxonomyService(dataSource as never).tree())
      .rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
