import type {
  CreateTaxonomyNodeInput,
  SignTag,
  SignTagInput,
  SignTagListResponse,
  TaxonomyNode,
  TaxonomyNodeInput,
  TaxonomyTreeResponse,
} from './types';

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? '服务响应格式无效' : '服务暂时不可用，请稍后重试');
  }
  const payload = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? '标签管理请求失败');
  return payload;
}

export const taxonomyApi = {
  tree(token: string) {
    return request<TaxonomyTreeResponse>('/taxonomy/tree', token);
  },
  signTags(token: string, page: number, pageSize: number, systemCode?: string, keyword?: string) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (systemCode) params.set('system_code', systemCode);
    if (keyword?.trim()) params.set('keyword', keyword.trim());
    return request<SignTagListResponse>(`/taxonomy/sign-tags?${params}`, token);
  },
  createNode(token: string, input: CreateTaxonomyNodeInput) {
    return request<TaxonomyNode>('/taxonomy/nodes', token, { method: 'POST', body: JSON.stringify(input) });
  },
  updateNode(token: string, id: string, input: TaxonomyNodeInput) {
    return request<TaxonomyNode>(`/taxonomy/nodes/${id}`, token, { method: 'PUT', body: JSON.stringify(input) });
  },
  deleteNode(token: string, id: string) {
    return request<{ id: string; deleted: true }>(`/taxonomy/nodes/${id}`, token, { method: 'DELETE' });
  },
  createSignTag(token: string, input: SignTagInput) {
    return request<SignTag>('/taxonomy/sign-tags', token, { method: 'POST', body: JSON.stringify(input) });
  },
  updateSignTag(token: string, id: string, input: SignTagInput) {
    return request<SignTag>(`/taxonomy/sign-tags/${id}`, token, { method: 'PUT', body: JSON.stringify(input) });
  },
  deleteSignTag(token: string, id: string) {
    return request<{ id: string; deleted: true }>(`/taxonomy/sign-tags/${id}`, token, { method: 'DELETE' });
  },
};
