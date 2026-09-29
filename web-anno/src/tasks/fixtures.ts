// Synthetic interface mocks for task-page tests; never imported by the application.
import type { Task, TaskCase } from './api';
export const syntheticTask: Task = {
  id: '10000000-0000-4000-8000-000000000001', name: '合成呼吸任务', source: 'synthetic', system_code: 'resp',
  review_mode: 'peer', priority: 1, in_flight_limit: null, status: '进行中', created_at: '2026-09-28T00:00:00Z', case_count: 1,
};
export const syntheticCase: TaskCase = {
  id: '20000000-0000-4000-8000-000000000001', case_no: 'SYN-TASK-1', source: 'synthetic', system_code: 'resp', status: '已录入',
};
