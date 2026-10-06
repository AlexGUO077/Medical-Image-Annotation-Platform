import { BadRequestException } from '@nestjs/common';
import { SYSTEM_CODES, IMPORT_SOURCES } from '../cases/cases-import.models';
import { uuid } from '../annotations/annotation-input';

export const GROUPS = ['task', 'person', 'system', 'source', 'day'] as const;
export interface StatsInput {
  task_id?: string; person_id?: string; system_code?: string; source?: string;
  from: string; to: string; group_by: typeof GROUPS[number]; page: number; pageSize: number;
}
export function beijingDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new BadRequestException('统计日期无效');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException('统计日期无效');
  return value;
}
export function parseStats(query: Record<string, unknown>, now = new Date()): StatsInput {
  if (Object.keys(query).some(k => !['task_id','person_id','system_code','source','from','to','group_by','page','pageSize'].includes(k))) throw new BadRequestException('统计参数无效');
  const selected: Pick<StatsInput,'task_id'|'person_id'|'system_code'|'source'> = {};
  for (const key of ['task_id','person_id'] as const) if (query[key] !== undefined) selected[key] = uuid(query[key]);
  for (const [key, allowed] of [['system_code',SYSTEM_CODES],['source',IMPORT_SOURCES]] as const) {
    if (query[key] !== undefined) {
      if (typeof query[key] !== 'string' || !allowed.some(value => value === query[key])) throw new BadRequestException('统计范围参数无效');
      selected[key] = query[key] as string;
    }
  }
  const to = query.to === undefined ? beijingDay(now) : date(query.to);
  if ((query.from === undefined) !== (query.to === undefined)) throw new BadRequestException('起止日期须同时提供');
  const from = query.from === undefined ? new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0,10) : date(query.from);
  if (from > to) throw new BadRequestException('起始日期不得晚于结束日期');
  const group = query.group_by ?? 'task';
  if (typeof group !== 'string' || !GROUPS.some(value => value === group)) throw new BadRequestException('统计分组无效');
  const integer = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new BadRequestException('统计分页无效');
    return Number(value);
  };
  const page = integer(query.page,1), pageSize = integer(query.pageSize,20);
  if (pageSize > 100 || !Number.isSafeInteger((page-1)*pageSize)) throw new BadRequestException('统计分页无效');
  return {...selected,from,to,group_by:group as StatsInput['group_by'],page,pageSize};
}
