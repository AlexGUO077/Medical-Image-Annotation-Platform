import { afterEach, describe, expect, it, vi } from 'vitest';
import { taxonomyApi } from './api';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('taxonomyApi', () => {
  it('sends the paginated administrator sign query with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], page: 2, pageSize: 20, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await taxonomyApi.signTags('synthetic-token', 2, 20, 'resp', '  合成  ');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/taxonomy/sign-tags?page=2&pageSize=20&system_code=resp&keyword=%E5%90%88%E6%88%90',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }) }),
    );
  });

  it('uses the contracted method and payload when creating a node', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'node' }));
    vi.stubGlobal('fetch', fetchMock);
    const input = { parent_id: 'parent', name: '合成节点', synonyms: [], icd: null };

    await taxonomyApi.createNode('synthetic-token', input);

    expect(fetchMock).toHaveBeenCalledWith('/api/taxonomy/nodes', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' }),
    }));
  });

  it('uses DELETE for sign removal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'sign', deleted: true }));
    vi.stubGlobal('fetch', fetchMock);

    await taxonomyApi.deleteSignTag('synthetic-token', 'sign');

    expect(fetchMock).toHaveBeenCalledWith('/api/taxonomy/sign-tags/sign', expect.objectContaining({ method: 'DELETE' }));
  });
});
