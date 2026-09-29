import type { ImportSource, SystemCode } from '../cases/types';

export interface Task {
  id: string; name: string; source: ImportSource; system_code: SystemCode;
  review_mode: 'self' | 'peer'; priority: number; in_flight_limit: number | null; status: string; created_at: string; case_count: number;
}
export interface TaskCase {
  id: string; case_no: string; source: ImportSource; system_code: SystemCode; status: string;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface CreateTask {
  name: string; source: ImportSource; system_code: SystemCode; review_mode: 'self' | 'peer';
  priority: number; case_ids: string[];
}
export interface Assignee {
  id: string; username: string; real_name: string; role: 'admin' | 'member';
  quals: Partial<Record<SystemCode, ('annotate' | 'review')[]>>; status: string;
  expire_at: string; must_change_password: boolean; mfa_enabled: boolean; in_flight_limit: number | null;
}
export interface ManualDispatch { mode: 'manual'; task_id: string; assignee_id: string; case_ids: string[]; due_at: string | null }
export interface TaskQuery { page?: number; pageSize?: number; source?: ImportSource; system_code?: SystemCode }
async function request<T>(path: string, token: string, options: RequestInit = {}, base = '/api/tasks'): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, cache: 'no-store', headers: {
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
  assignees: (token: string, page: number, signal?: AbortSignal) => request<Page<Assignee>>(queryString({ page, pageSize: 20 }), token, { signal }, '/api/users'),
  settings: (token: string, id: string, input: { priority: number; in_flight_limit: number | null }) => request<{ id: string; priority: number; in_flight_limit: number | null }>(`/${encodeURIComponent(id)}/settings`, token, { method: 'PATCH', body: JSON.stringify(input) }),
  personLimit: (token: string, id: string, limit: number | null) => request<{ id: string; in_flight_limit: number | null }>(`/assignees/${encodeURIComponent(id)}/limit`, token, { method: 'PATCH', body: JSON.stringify({ in_flight_limit: limit }) }),
  dispatch: (token: string, input: ManualDispatch) => request<ManualDispatch & { task_role: 'annotate' }>('/dispatch', token, { method: 'POST', body: JSON.stringify(input) }),
  list: (token: string, query: TaskQuery, signal?: AbortSignal) => request<Page<Task>>(queryString(query), token, { signal }),
  eligible: (token: string, query: TaskQuery, signal?: AbortSignal) => request<Page<TaskCase>>(`/eligible-cases${queryString(query)}`, token, { signal }),
  cases: (token: string, id: string, page: number, signal?: AbortSignal) => request<Page<TaskCase>>(`/${encodeURIComponent(id)}/cases${queryString({ page, pageSize: 20 })}`, token, { signal }),
  create: (token: string, input: CreateTask) => request<CreateTask & { id: string; status: string }>('', token, { method: 'POST', body: JSON.stringify(input) }),
};
