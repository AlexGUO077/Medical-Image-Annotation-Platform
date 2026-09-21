import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.models';
import { TaxonomyService } from './taxonomy.service';

const admin: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  password_hash: 'unused',
  real_name: '合成管理员',
  role: 'admin',
  quals: {},
  status: 'active',
  expire_at: '2099-12-31',
  must_change_password: false,
  mfa_secret_encrypted: 'encrypted',
  updated_at: new Date('2026-09-21T00:00:00Z'),
};

const rootId = '10000000-0000-4000-8000-000000000001';
const partId = '11000000-0000-4000-8000-000000000001';

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

  it('creates a child at the level below its parent and audits in the same transaction', async () => {
    const manager = {
      query: vi.fn()
        .mockResolvedValueOnce([{ id: rootId, parent_id: null, level: 1, name: '呼吸', synonyms: [], icd: null }])
        .mockResolvedValueOnce([{ id: partId, parent_id: rootId, level: 2, name: '合成部位', synonyms: ['别名'], icd: null }])
        .mockResolvedValueOnce([]),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };

    const result = await new TaxonomyService(dataSource as never).createNode(admin, {
      parent_id: rootId,
      name: ' 合成部位 ',
      synonyms: ['别名', '别名', ' '],
      icd: null,
    }, '127.0.0.1');

    expect(result).toMatchObject({ id: partId, level: 2, name: '合成部位', synonyms: ['别名'] });
    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(manager.query.mock.calls[2]?.[1]).toEqual(expect.arrayContaining([
      admin.id,
      'taxonomy.node_created',
      `taxonomy_nodes:${partId}`,
    ]));
  });

  it('prevents editing a fixed system root', async () => {
    const manager = {
      query: vi.fn().mockResolvedValueOnce([
        { id: rootId, parent_id: null, level: 1, name: '呼吸', synonyms: [], icd: null },
      ]),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };

    await expect(new TaxonomyService(dataSource as never).updateNode(admin, rootId, {
      name: '修改系统', synonyms: [], icd: null,
    }, '127.0.0.1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('rejects deletion when a node has children or business references', async () => {
    const manager = {
      query: vi.fn()
        .mockResolvedValueOnce([{ id: partId, parent_id: rootId, level: 2, name: '合成部位', synonyms: [], icd: null }])
        .mockResolvedValueOnce([{ has_children: true, used_by_cases: false, used_by_annotations: false }]),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };

    await expect(new TaxonomyService(dataSource as never).deleteNode(admin, partId, '127.0.0.1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('rejects management pagination above 100 before querying', async () => {
    const dataSource = { query: vi.fn() };

    await expect(new TaxonomyService(dataSource as never).listSignTags('1', '101', undefined, undefined))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('maps concurrent active-name conflicts to HTTP 409 behavior', async () => {
    const manager = { query: vi.fn().mockRejectedValueOnce({ code: '23505' }) };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };

    await expect(new TaxonomyService(dataSource as never).createSignTag(admin, {
      name: '合成征象', system_code: 'resp', definition: '仅用于合成验证',
    }, '127.0.0.1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects deleting a sign that is referenced by an annotation', async () => {
    const signId = '20000000-0000-4000-8000-000000000001';
    const manager = {
      query: vi.fn()
        .mockResolvedValueOnce([{ id: signId, name: '合成征象', system_code: 'resp', definition: '仅用于合成验证' }])
        .mockResolvedValueOnce([{ used: true }]),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };

    await expect(new TaxonomyService(dataSource as never).deleteSignTag(admin, signId, '127.0.0.1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
