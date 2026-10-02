import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { IMPORT_SOURCES, SYSTEM_CODES } from '../cases/cases-import.models';
import { DATABASE_SOURCE } from '../database/database.tokens';

interface CreateTaskInput {
  name: string;
  source: string;
  system_code: string;
  review_mode: 'self' | 'peer';
  priority: number;
  dispatch_mode: 'auto' | 'manual' | 'pool';
  case_ids: string[];
}

@Injectable()
export class TasksService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource) {}

  async create(actor: AuthUser, body: unknown, ip: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const input = this.input(body);
    return this.db.transaction(async (manager) => {
      // Hold the account stable until the protected write commits.
      const users = await manager.query(
        `SELECT "role", "status", "expire_at"::text AS "expire_at", "must_change_password",
                "mfa_secret_encrypted", "updated_at" FROM "users"
         WHERE "id" = $1 AND "deleted_at" IS NULL FOR SHARE`, [actor.id],
      ) as AuthUser[];
      const current = users[0];
      if (!current || current.updated_at.getTime() !== actor.updated_at.getTime()) {
        throw new UnauthorizedException('会话已失效，请重新登录');
      }
      if (current.role !== 'admin' || current.status !== 'active' ||
          current.expire_at < new Date().toISOString().slice(0, 10) ||
          current.must_change_password || !current.mfa_secret_encrypted) {
        throw new ForbiddenException('账号无权创建任务');
      }
      const cases = await manager.query(
        `SELECT "id", "source", "system_code", "status" FROM "cases"
         WHERE "id" = ANY($1::uuid[]) AND "deleted_at" IS NULL ORDER BY "id" FOR UPDATE`,
        [input.case_ids],
      ) as Array<{ id: string; source: string; system_code: string; status: string }>;
      if (cases.length !== input.case_ids.length) throw new NotFoundException('病例不存在');
      if (cases.some((item) => item.source !== input.source || item.system_code !== input.system_code || item.status !== '已录入')) {
        throw new ConflictException('病例来源、系统或状态不符合任务要求');
      }
      // Under READ COMMITTED this check relies on the cases FOR UPDATE locks above;
      // keep the membership check and writes in this same transaction.
      const assigned = await manager.query(
        'SELECT "id" FROM "task_cases" WHERE "case_id" = ANY($1::uuid[]) AND "deleted_at" IS NULL LIMIT 1',
        [input.case_ids],
      ) as unknown[];
      if (assigned.length) throw new ConflictException('病例已属于其他任务');
      const confirmed = await manager.query(
        `SELECT DISTINCT "target" FROM "audit_logs"
         WHERE "target" = ANY($1::text[]) AND "action" IN ('case_import.deidentification_confirmed', 'case_manual.confirmed')`,
        [input.case_ids.map((id) => `cases:${id}`)],
      ) as Array<{ target: string }>;
      if (confirmed.length !== cases.length) throw new ConflictException('病例缺少脱敏人工确认记录');

      const [task] = await manager.query(
        `INSERT INTO "tasks" ("name", "source", "system_code", "review_mode", "priority", "dispatch_mode", "status")
         VALUES ($1, $2, $3, $4, $5, $6, '进行中') RETURNING "id"`,
        [input.name, input.source, input.system_code, input.review_mode, input.priority, input.dispatch_mode],
      ) as Array<{ id: string }>;
      if (!task) throw new Error('Task insert returned no id');
      await manager.query(
        'INSERT INTO "task_cases" ("task_id", "case_id") SELECT $1::uuid, unnest($2::uuid[])',
        [task.id, input.case_ids],
      );
      await manager.query(
        `UPDATE "cases" SET "status" = '待分配', "updated_at" = now() WHERE "id" = ANY($1::uuid[])`,
        [input.case_ids],
      );
      await manager.query(
        `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
         VALUES ($1, 'tasks.created', $2, $3::jsonb, $4)`,
        [actor.id, `tasks:${task.id}`, JSON.stringify({
          source: input.source, system_code: input.system_code, review_mode: input.review_mode,
          priority: input.priority, dispatch_mode: input.dispatch_mode, case_ids: input.case_ids, from: '已录入', to: '待分配',
        }), ip],
      );
      return { id: task.id, ...input, status: '进行中' as const };
    });
  }

  async list(actor: AuthUser, query: Record<string, unknown>) {
    this.admin(actor);
    const { page, pageSize, offset } = this.pagination(query);
    const source = this.scope(query.source, IMPORT_SOURCES, false);
    const system = this.scope(query.system_code, SYSTEM_CODES, false);
    const where = `t."deleted_at" IS NULL AND ($1::text IS NULL OR t."source"=$1) AND ($2::text IS NULL OR t."system_code"=$2)`;
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const items = await manager.query(
        `SELECT t."id", t."name", t."source", t."system_code", t."review_mode", t."priority", t."in_flight_limit", t."dispatch_mode", t."status", t."created_at",
          (SELECT count(*)::int FROM "task_cases" tc JOIN "cases" c ON c."id"=tc."case_id"
           WHERE tc."task_id"=t."id" AND tc."deleted_at" IS NULL AND c."deleted_at" IS NULL) AS "case_count"
         FROM "tasks" t WHERE ${where} ORDER BY t."priority" DESC, t."created_at" DESC, t."id" LIMIT $3 OFFSET $4`,
        [source, system, pageSize, offset],
      );
      const [count] = await manager.query(`SELECT count(*)::int AS "total" FROM "tasks" t WHERE ${where}`, [source, system]);
      return { items, total: count.total as number, page, pageSize };
    });
  }

  async eligibleCases(actor: AuthUser, query: Record<string, unknown>) {
    this.admin(actor);
    const { page, pageSize, offset } = this.pagination(query);
    const source = this.scope(query.source, IMPORT_SOURCES, true);
    const system = this.scope(query.system_code, SYSTEM_CODES, true);
    const where = `c."deleted_at" IS NULL AND c."status"='已录入' AND c."source"=$1 AND c."system_code"=$2
      AND NOT EXISTS (SELECT 1 FROM "task_cases" tc WHERE tc."case_id"=c."id" AND tc."deleted_at" IS NULL)
      AND EXISTS (SELECT 1 FROM "audit_logs" a WHERE a."target"='cases:' || c."id"::text
        AND a."action" IN ('case_import.deidentification_confirmed', 'case_manual.confirmed'))`;
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const items = await manager.query(
        `SELECT c."id", c."case_no", c."status", c."source", c."system_code" FROM "cases" c
         WHERE ${where} ORDER BY c."created_at", c."id" LIMIT $3 OFFSET $4`, [source, system, pageSize, offset],
      );
      const [count] = await manager.query(`SELECT count(*)::int AS "total" FROM "cases" c WHERE ${where}`, [source, system]);
      return { items, total: count.total as number, page, pageSize };
    });
  }

  async cases(actor: AuthUser, id: string, query: Record<string, unknown>) {
    this.admin(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('任务标识必须是 UUID');
    }
    const { page, pageSize, offset } = this.pagination(query);
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const tasks = await manager.query('SELECT "id" FROM "tasks" WHERE "id"=$1 AND "deleted_at" IS NULL', [id]);
      if (!tasks.length) throw new NotFoundException('任务不存在');
      const from = `FROM "task_cases" tc JOIN "cases" c ON c."id"=tc."case_id"
        WHERE tc."task_id"=$1 AND tc."deleted_at" IS NULL AND c."deleted_at" IS NULL`;
      const items = await manager.query(
        `SELECT c."id", c."case_no", c."status", c."source", c."system_code",
           (SELECT a.id FROM task_assignments a WHERE a.case_id=c.id AND a.task_role=CASE WHEN c.status='标注中' THEN 'annotate' ELSE 'review' END AND a.state='active' AND a.deleted_at IS NULL) AS assignment_id ${from}
         ORDER BY tc."created_at", c."id" LIMIT $2 OFFSET $3`, [id, pageSize, offset],
      );
      const [count] = await manager.query(`SELECT count(*)::int AS "total" ${from}`, [id]);
      return { items, total: count.total as number, page, pageSize };
    });
  }

  private admin(actor: AuthUser): void {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
  }

  private scope(value: unknown, allowed: readonly string[], required: boolean): string | null {
    if (value === undefined && !required) return null;
    if (typeof value !== 'string' || !allowed.includes(value)) throw new BadRequestException('来源或系统参数无效');
    return value;
  }

  private pagination(query: Record<string, unknown>) {
    const parse = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
        throw new BadRequestException('分页参数无效');
      }
      return Number(value);
    };
    const page = parse(query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parse(query.pageSize, 20, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new BadRequestException('分页参数无效');
    return { page, pageSize, offset };
  }

  private input(body: unknown): CreateTaskInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('任务请求无效');
    const input = body as Record<string, unknown>;
    const keys = ['name', 'source', 'system_code', 'review_mode', 'priority', 'case_ids', 'dispatch_mode'];
    if (Object.keys(input).some((key) => !keys.includes(key)) ||
        typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 200 ||
        !IMPORT_SOURCES.includes(input.source as never) || !SYSTEM_CODES.includes(input.system_code as never) ||
        !['self', 'peer'].includes(input.review_mode as string) ||
        (input.dispatch_mode !== undefined && !['auto', 'manual', 'pool'].includes(input.dispatch_mode as string)) ||
        typeof input.priority !== 'number' || !Number.isInteger(input.priority) ||
        input.priority < -2147483648 || input.priority > 2147483647 ||
        !Array.isArray(input.case_ids) || input.case_ids.length === 0 || input.case_ids.length > 2000 ||
        input.case_ids.some((id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException('任务字段无效');
    }
    const caseIds = (input.case_ids as string[]).map((id) => id.toLowerCase()).sort();
    if (new Set(caseIds).size !== caseIds.length) throw new BadRequestException('病例不能重复');
    return { name: input.name.trim(), source: input.source as string, system_code: input.system_code as string,
      review_mode: input.review_mode as 'self' | 'peer', priority: input.priority, dispatch_mode: (input.dispatch_mode ?? 'auto') as CreateTaskInput['dispatch_mode'], case_ids: caseIds };
  }
}
