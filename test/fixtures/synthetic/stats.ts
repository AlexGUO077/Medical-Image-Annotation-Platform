// Synthetic contract response; no clinical or per-case content.
const metrics = { completed: 2, normal_passed: 2, normal_returned: 1, normal_total: 3,
  return_rate: 1 / 3, spotcheck_passed: 1, spotcheck_returned: 1, spotcheck_total: 2, spotcheck_pass_rate: 0.5 };
export const statsResult = {
  filters: { from: '2026-10-01', to: '2026-10-02', group_by: 'task' as const, timezone: 'Asia/Shanghai' as const },
  summary: { ...metrics },
  trend: [{ day: '2026-10-01', ...metrics }, { day: '2026-10-02', completed: 0, normal_passed: 0,
    normal_returned: 0, normal_total: 0, return_rate: null, spotcheck_passed: 0, spotcheck_returned: 0,
    spotcheck_total: 0, spotcheck_pass_rate: null }],
  items: [{ key: '10000000-0000-4000-8000-000000000001', label: '合成质控任务', ...metrics }],
  page: 1, pageSize: 20, total: 1,
};
