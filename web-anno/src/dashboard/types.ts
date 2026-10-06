import type { ImportSource, SystemCode } from '../cases/types';
export type StatsGroup = 'task' | 'person' | 'system' | 'source' | 'day';
export interface StatsQuery {
  task_id?: string; person_id?: string; system_code?: SystemCode; source?: ImportSource;
  from?: string; to?: string; group_by?: StatsGroup; page?: number; pageSize?: number;
}
export interface Metrics {
  completed: number; normal_passed: number; normal_returned: number; normal_total: number; return_rate: number | null;
  spotcheck_passed: number; spotcheck_returned: number; spotcheck_total: number; spotcheck_pass_rate: number | null;
}
export interface StatsResult {
  filters: StatsQuery & {from:string;to:string;group_by:StatsGroup;timezone:'Asia/Shanghai'};
  summary: Metrics; trend: (Metrics & {day:string})[]; items: (Metrics & {key:string;label:string})[];
  page:number;pageSize:number;total:number;
}
export interface StatsOptions {items:{value:string;label:string}[];page:number;total:number}
export const GROUP_OPTIONS = [{value:'task',label:'任务'},{value:'person',label:'提交标注人'},
  {value:'system',label:'系统'},{value:'source',label:'来源'},{value:'day',label:'日期'}] as const;
