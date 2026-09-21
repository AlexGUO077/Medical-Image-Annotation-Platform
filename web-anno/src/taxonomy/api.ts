import type { TaxonomyTreeResponse } from './types';

export async function getTaxonomyTree(token: string): Promise<TaxonomyTreeResponse> {
  const response = await fetch('/api/taxonomy/tree', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? '服务响应格式无效' : '服务暂时不可用，请稍后重试');
  }
  const payload = await response.json() as { message?: string } & TaxonomyTreeResponse;
  if (!response.ok) throw new Error(payload.message ?? '标签数据加载失败');
  return payload;
}
