import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { accountAvailable } from '../tasks/assignment-release';
import { systemNames } from '../search/published-case';
import { parseStats } from './stats-input';

export interface Counts {
  completed: number; normal_passed: number; normal_returned: number; normal_total: number;
  spotcheck_passed: number; spotcheck_returned: number; spotcheck_total: number;
}
export function metrics<T extends Counts>(counts: T) {
  return {...counts, return_rate: counts.normal_total ? counts.normal_returned/counts.normal_total : null,
    spotcheck_pass_rate: counts.spotcheck_total ? counts.spotcheck_passed/counts.spotcheck_total : null};
}
const counts = `count(DISTINCT (e.case_id,e.version)) FILTER(WHERE e.kind='normal' AND e.result='通过')::int AS completed,
 count(*) FILTER(WHERE e.kind='normal' AND e.result='通过')::int AS normal_passed,
 count(*) FILTER(WHERE e.kind='normal' AND e.result='打回')::int AS normal_returned,
 count(*) FILTER(WHERE e.kind='normal')::int AS normal_total,
 count(*) FILTER(WHERE e.kind='spotcheck' AND e.result='通过')::int AS spotcheck_passed,
 count(*) FILTER(WHERE e.kind='spotcheck' AND e.result='打回')::int AS spotcheck_returned,
 count(*) FILTER(WHERE e.kind='spotcheck')::int AS spotcheck_total`;
const groupColumns = {task:['e.task_id','e.task_name'],person:['e.person_id','e.person_name'],
  system:['e.system_code','e.system_code'],source:['e.source','e.source'],day:['e.day::text','e.day::text']} as const;

@Injectable()
export class StatsService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource) {}
  async read(actor: AuthUser, query: Record<string, unknown>) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const input = parseStats(query);
    return this.db.transaction(async manager => {
      const [user] = await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[actor.id]) as AuthUser[];
      if (!user || user.role !== 'admin' || !accountAvailable(user) || user.updated_at.getTime() !== actor.updated_at.getTime()) throw new ForbiddenException('账号或会话已失效');
      await manager.query("SET LOCAL statement_timeout = '5s'");
      const [key, label] = groupColumns[input.group_by];
      // One statement/snapshot for summary, daily trend and paged groups. No current assignments or annotation version.
      let result: {summary: Counts; trend: (Counts & {day:string})[]; items: (Counts & {key:string;label:string})[]; total:number};
      try {
        [result] = await manager.query(`WITH events AS MATERIALIZED (
          SELECT r.case_id, d.detail->>'version' AS version, r.result, COALESCE(d.detail->>'review_kind','normal') AS kind,
            (r.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, t.id::text AS task_id, t.name AS task_name,
            t.system_code,t.source, p.id::text AS person_id,p.real_name||' ('||p.username||')' AS person_name
          FROM reviews r JOIN cases c ON c.id=r.case_id
          JOIN LATERAL (SELECT a.detail FROM audit_logs a WHERE a.target='cases:'||r.case_id::text
            AND a.action='reviews.decided' AND a.detail->>'review_id'=r.id::text AND a.actor=r.reviewer_id
            AND a.detail->>'result'=r.result ORDER BY a.created_at DESC,a.id LIMIT 1) d ON true
          JOIN tasks t ON t.id::text=d.detail->>'task_id'
          JOIN LATERAL (SELECT a.actor FROM audit_logs a WHERE a.target='cases:'||r.case_id::text
            AND a.action='annotations.submitted' AND a.detail->>'task_id'=t.id::text
            AND a.detail->>'version'=d.detail->>'version' AND a.created_at<=r.created_at
            ORDER BY a.created_at DESC,a.id LIMIT 1) submitted ON true
          JOIN users p ON p.id=submitted.actor
          WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL AND t.deleted_at IS NULL
            AND c.source='synthetic' AND t.source='synthetic'
            AND d.detail->>'version' ~ '^(0|[1-9][0-9]*)$'
            AND COALESCE(d.detail->>'review_kind','normal') IN ('normal','spotcheck')
            AND r.is_spotcheck=(COALESCE(d.detail->>'review_kind','normal')='spotcheck')
            AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.target='cases:'||c.id::text
              AND a.action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))
            AND r.created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
            AND r.created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
            AND ($3::text IS NULL OR t.id::text=$3) AND ($4::text IS NULL OR p.id::text=$4)
            AND ($5::text IS NULL OR t.system_code=$5) AND ($6::text IS NULL OR t.source=$6)
        ), summary AS (SELECT ${counts} FROM events e),
        days AS (SELECT day::date FROM generate_series($1::date::timestamp,$2::date::timestamp,interval '1 day') day),
        daily AS (SELECT d.day::text AS day,${counts} FROM days d LEFT JOIN events e ON e.day=d.day GROUP BY d.day),
        groups AS (SELECT ${key} AS key,min(${label}) AS label,${counts} FROM events e GROUP BY ${key}),
        paged AS (SELECT * FROM groups ORDER BY key COLLATE "C" LIMIT $7 OFFSET $8)
        SELECT (SELECT to_jsonb(s) FROM summary s) AS summary,
          COALESCE((SELECT jsonb_agg(d ORDER BY d.day) FROM daily d),'[]'::jsonb) AS trend,
          COALESCE((SELECT jsonb_agg(p ORDER BY p.key COLLATE "C") FROM paged p),'[]'::jsonb) AS items,
          (SELECT count(*)::int FROM groups) AS total`,
          [input.from,input.to,input.task_id??null,input.person_id??null,input.system_code??null,input.source??null,input.pageSize,(input.page-1)*input.pageSize]);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '57014') throw new ServiceUnavailableException('统计查询超时，请缩小日期范围后重试');
        throw error;
      }
      // Account expiry can elapse while aggregating; a locked account cannot be disabled mid-response.
      if (!accountAvailable(user)) throw new ForbiddenException('账号已过期');
      return {filters:{...input,timezone:'Asia/Shanghai'},summary:metrics(result.summary),trend:result.trend.map(metrics),
        items:result.items.map(item=>metrics({...item,label:input.group_by==='system'?systemNames[item.key as keyof typeof systemNames]:input.group_by==='source'?'合成数据':item.label})),
        page:input.page,pageSize:input.pageSize,total:result.total};
    });
  }
}
