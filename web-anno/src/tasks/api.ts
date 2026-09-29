import type { ImportSource, SystemCode } from '../cases/types';

export interface Task {
  id: string; name: string; source: ImportSource; system_code: SystemCode;
  review_mode: 'self' | 'peer'; priority: number; status: string; created_at: string; case_count: number;
}
export interface TaskCase {
  id: string; case_no: string; source: ImportSource; system_code: SystemCode; status: string;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface CreateTask {
  name: string; source: ImportSource; system_code: SystemCode; review_mode: 'self' | 'peer';
  priority: number; case_ids: string[];
}
export interface TaskQuery { page?: number; pageSize?: number; source?: ImportSource; system_code?: SystemCode }
async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/tasks${path}`, { ...options, cache: 'no-store', headers: {
    Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务响应格式无效');
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? '任务请求失败');
  return payload;
}
function queryString(query: TaskQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  return `?${params.toString()}`;
}
export const tasksApi = {
  list: (token: string, query: TaskQuery, signal?: AbortSignal) => request<Page<Task>>(queryString(query), token, { signal }),
  eligible: (token: string, query: TaskQuery, signal?: AbortSignal) => request<Page<TaskCase>>(`/eligible-cases${queryString(query)}`, token, { signal }),
  cases: (token: string, id: string, page: number, signal?: AbortSignal) => request<Page<TaskCase>>(`/${encodeURIComponent(id)}/cases${queryString({ page, pageSize: 20 })}`, token, { signal }),
  create: (token: string, input: CreateTask) => request<CreateTask & { id: string; status: string }>('', token, { method: 'POST', body: JSON.stringify(input) }),
};
