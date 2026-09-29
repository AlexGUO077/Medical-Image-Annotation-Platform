import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { IMPORT_SOURCES, SYSTEM_CODES } from '../cases/cases-import.models';
import { DATABASE_SOURCE } from '../database/database.tokens';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CapacityUser = AuthUser & { in_flight_limit: number | null };

@Injectable()
export class TaskDispatchService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource) {}

  async dispatch(actor: AuthUser, body: unknown, ip: string) {
    const mode = body && typeof body === 'object' ? (body as Record<string, unknown>).mode : undefined;
    if (mode === 'auto') return this.auto(actor, body, ip);
    const pool = mode === 'pool';
    if (!pool && actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    if (pool) {
      const claim = this.object(body, ['mode', 'task_id', 'case_id']);
      body = { mode: 'manual', task_id: claim.task_id, assignee_id: actor.id, case_ids: [this.id(claim.case_id)], due_at: null };
    }
    const input = this.object(body, ['mode', 'task_id', 'assignee_id', 'case_ids', 'due_at']);
    if (input.mode !== 'manual') throw new BadRequestException('分发模式无效');
    const taskId = this.id(input.task_id), assigneeId = this.id(input.assignee_id);
    if (!Array.isArray(input.case_ids) || !input.case_ids.length || input.case_ids.length > 2000) {
      throw new BadRequestException('病例数量无效');
    }
    const ids = input.case_ids.map(id => this.id(id)).sort();
    if (new Set(ids).size !== ids.length) throw new BadRequestException('病例不能重复');
    let due: string | null = null;
    if (input.due_at !== undefined && input.due_at !== null) {
      if (typeof input.due_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(input.due_at) ||
          !Number.isFinite(Date.parse(input.due_at)) || Date.parse(input.due_at) <= Date.now() ||
          new Date(`${input.due_at.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== input.due_at.slice(0, 10)) {
        throw new BadRequestException('截止时间必须是未来的带时区时间');
      }
      due = new Date(input.due_at).toISOString();
    }
    return this.db.transaction(async manager => {
      const users = await this.lockUsers(manager, actor, assigneeId, pool);
      const assignee = users.find(user => user.id === assigneeId);
      if (!assignee) throw new NotFoundException('承接人不存在');
      if (!this.enabled(assignee)) throw new ForbiddenException('承接人账号不可用');
      const task = await this.task(manager, taskId);
      if (pool && task.dispatch_mode === 'manual') throw new ConflictException('手动模式任务不开放领取');
      if (!assignee.quals[task.system_code]?.includes('annotate') ||
          (task.review_mode === 'self' && !assignee.quals[task.system_code]?.includes('review'))) {
        throw new ForbiddenException('承接人缺少任务所需系统资格');
      }
      const cases = await manager.query(`SELECT id, source, system_code, status FROM cases
        WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [ids]);
      if (cases.length !== ids.length) throw new NotFoundException('病例不存在');
      if (cases.some((c: { source: string; system_code: string; status: string }) =>
        c.source !== task.source || c.system_code !== task.system_code || c.status !== '待分配')) {
        throw new ConflictException('病例来源、系统或状态不符合分派要求');
      }
      const links = await manager.query(`SELECT case_id FROM task_cases WHERE task_id=$1
        AND case_id=ANY($2::uuid[]) AND deleted_at IS NULL`, [taskId, ids]);
      if (links.length !== ids.length) throw new ConflictException('病例不属于该任务');
      const active = await manager.query(`SELECT id FROM task_assignments WHERE case_id=ANY($1::uuid[])
        AND deleted_at IS NULL AND state='active' LIMIT 1`, [ids]);
      if (active.length) throw new ConflictException('病例已有在途分派，须先回收');
      // The assignee row lock serializes capacity checks across every task and setting update.
      const [load] = await manager.query(`SELECT count(*)::int AS global_count,
        count(*) FILTER (WHERE tc.task_id=$2)::int AS task_count
        FROM task_assignments a JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
        JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
        JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL
        WHERE a.assignee_id=$1 AND a.deleted_at IS NULL AND a.state='active'
          AND (a.due_at IS NULL OR a.due_at > clock_timestamp())`, [assigneeId, taskId]);
      if ((task.in_flight_limit !== null && load.task_count + ids.length > task.in_flight_limit) ||
          (assignee.in_flight_limit !== null && load.global_count + ids.length > assignee.in_flight_limit)) {
        throw new ConflictException('超过任务级或人员全局在途上限');
      }
      // Recheck after lock waits; never insert a deadline that expired while waiting.
      if (due && Date.parse(due) <= Date.now()) throw new BadRequestException('截止时间已过期');
      await manager.query(`INSERT INTO task_assignments (case_id, assignee_id, task_role, due_at, state)
        SELECT unnest($1::uuid[]), $2, 'annotate', $3, 'active'`, [ids, assigneeId, due]);
      await manager.query(`UPDATE cases SET status='标注中', updated_at=now() WHERE id=ANY($1::uuid[])`, [ids]);
      const result = { task_id: taskId, assignee_id: assigneeId, case_ids: ids, due_at: due, task_role: 'annotate' };
      await this.audit(manager, actor, pool ? 'tasks.claimed' : 'tasks.dispatched', `tasks:${taskId}`, { ...result, mode: pool ? 'pool' : 'manual', from: '待分配', to: '标注中' }, ip);
      return result;
    });
  }

  async settings(actor: AuthUser, id: string, body: unknown, ip: string) {
    const taskId = this.id(id), input = this.object(body, ['priority', 'in_flight_limit', 'dispatch_mode']);
    if (!Object.keys(input).length) throw new BadRequestException('没有可更新字段');
    if ('priority' in input && (typeof input.priority !== 'number' || !Number.isInteger(input.priority) ||
        input.priority < -2147483648 || input.priority > 2147483647)) throw new BadRequestException('优先级无效');
    if ('in_flight_limit' in input) this.limit(input.in_flight_limit);
    if ('dispatch_mode' in input && !['auto', 'manual', 'pool'].includes(input.dispatch_mode as string)) throw new BadRequestException('分发模式无效');
    return this.db.transaction(async manager => {
      await this.lockUsers(manager, actor);
      const task = await this.task(manager, taskId);
      const priority = 'priority' in input ? input.priority : task.priority;
      const limit = 'in_flight_limit' in input ? input.in_flight_limit : task.in_flight_limit;
      const mode = input.dispatch_mode ?? task.dispatch_mode;
      await manager.query('UPDATE tasks SET priority=$2, in_flight_limit=$3, dispatch_mode=$4, updated_at=now() WHERE id=$1', [taskId, priority, limit, mode]);
      const result = { id: taskId, priority, in_flight_limit: limit, dispatch_mode: mode };
      await this.audit(manager, actor, 'tasks.settings_updated', `tasks:${taskId}`,
        { before: { priority: task.priority, in_flight_limit: task.in_flight_limit, dispatch_mode: task.dispatch_mode }, after: result }, ip);
      return result;
    });
  }

  async personLimit(actor: AuthUser, id: string, body: unknown, ip: string) {
    const userId = this.id(id), input = this.object(body, ['in_flight_limit']);
    this.limit(input.in_flight_limit);
    return this.db.transaction(async manager => {
      const users = await this.lockUsers(manager, actor, userId);
      const target = users.find(user => user.id === userId);
      if (!target) throw new NotFoundException('账号不存在');
      // updated_at is the login revocation version; capacity is not an account-security change.
      await manager.query('UPDATE users SET in_flight_limit=$2 WHERE id=$1', [userId, input.in_flight_limit]);
      await this.audit(manager, actor, 'users.capacity_updated', `users:${userId}`,
        { before: target.in_flight_limit, after: input.in_flight_limit }, ip);
      return { id: userId, in_flight_limit: input.in_flight_limit };
    });
  }

  async queue(actor: AuthUser, query: Record<string, unknown>, mine: boolean) {
    const number = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new BadRequestException('分页参数无效');
      return Number(value);
    };
    const page = number(query.page, 1, Number.MAX_SAFE_INTEGER), pageSize = number(query.pageSize, 20, 100), offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset) || (query.source !== undefined && !IMPORT_SOURCES.includes(query.source as never)) ||
        (query.system_code !== undefined && !SYSTEM_CODES.includes(query.system_code as never))) throw new BadRequestException('筛选或分页参数无效');
    return this.db.transaction('REPEATABLE READ', async manager => {
      const users = await manager.query('SELECT *, expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [actor.id]) as CapacityUser[];
      this.actor(users, actor, false);
      const user = users[0]!;
      const systems = Object.keys(user.quals).filter(system => user.quals[system]?.includes('annotate'));
      const dual = systems.filter(system => user.quals[system]?.includes('review'));
      const from = `FROM task_cases tc JOIN tasks t ON t.id=tc.task_id JOIN cases c ON c.id=tc.case_id
        ${mine ? "JOIN task_assignments a ON a.case_id=c.id AND a.assignee_id=$1 AND a.task_role='annotate' AND a.state='active' AND a.deleted_at IS NULL AND (a.due_at IS NULL OR a.due_at>clock_timestamp())" : ''}
        WHERE tc.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status='进行中' AND c.deleted_at IS NULL
          AND c.source=t.source AND c.system_code=t.system_code AND t.system_code=ANY($2::text[])
          AND (t.review_mode<>'self' OR t.system_code=ANY($3::text[]))
          AND ($4::text IS NULL OR t.source=$4) AND ($5::text IS NULL OR t.system_code=$5)
          AND ${mine ? "c.status='标注中'" : "c.status='待分配' AND t.dispatch_mode IN ('auto','pool') AND NOT EXISTS (SELECT 1 FROM task_assignments a WHERE a.case_id=c.id AND a.deleted_at IS NULL AND a.state='active')"}
          AND $1::uuid IS NOT NULL`;
      const values = [actor.id, systems, dual, query.source ?? null, query.system_code ?? null];
      const items = await manager.query(`SELECT t.id task_id,t.name task_name,t.priority,t.source,t.system_code,t.review_mode,
        c.id case_id,c.case_no,c.status ${mine ? ',a.id assignment_id,a.due_at' : ''} ${from}
        ORDER BY t.priority DESC,tc.created_at,c.id LIMIT $6 OFFSET $7`, [...values, pageSize, offset]);
      const [count] = await manager.query(`SELECT count(*)::int total ${from}`, values);
      return { items, total: count.total as number, page, pageSize };
    });
  }

  async autoAfter(actor: AuthUser, taskId: string, ip: string) {
    try { return { status: 'completed', ...await this.auto(actor, { mode: 'auto', task_id: taskId }, ip) }; }
    catch { return { status: 'pending' }; } // The preceding operation committed; never report creation failure.
  }

  private async auto(actor: AuthUser, body: unknown, ip: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const input = this.object(body, ['mode', 'task_id', 'after_case_id']);
    const taskId = input.task_id === undefined ? null : this.id(input.task_id);
    const after = input.after_case_id === undefined ? null : this.id(input.after_case_id);
    return this.db.transaction(async manager => {
      // A fixed user lock order also serializes auto against manual/pool and capacity changes.
      const users = await manager.query(`SELECT *, expire_at::text FROM users WHERE deleted_at IS NULL ORDER BY id FOR UPDATE`) as CapacityUser[];
      this.actor(users, actor, true);
      const tasks = await manager.query(`SELECT * FROM tasks WHERE deleted_at IS NULL AND status='进行中'
        AND ($1::uuid IS NULL OR id=$1) ORDER BY id FOR UPDATE`, [taskId]);
      if (taskId && !tasks.length) throw new NotFoundException('任务不存在或不在进行中');
      if (taskId && tasks[0].dispatch_mode !== 'auto') throw new ConflictException('任务不是自动分派模式');
      const autoTasks = tasks.filter((t: { dispatch_mode: string }) => t.dispatch_mode === 'auto');
      if (after) {
        const cursors = await manager.query('SELECT tc.case_id FROM task_cases tc WHERE tc.case_id=$1 AND tc.task_id=ANY($2::uuid[]) AND tc.deleted_at IS NULL', [after, autoTasks.map((t: { id: string }) => t.id)]);
        if (!cursors.length) throw new BadRequestException('续批游标不属于当前自动任务范围，请从头重试');
      }
      const cases = await manager.query(`SELECT c.id, tc.task_id FROM cases c JOIN task_cases tc ON tc.case_id=c.id
        JOIN tasks t ON t.id=tc.task_id WHERE tc.deleted_at IS NULL AND c.deleted_at IS NULL
          AND tc.task_id=ANY($1::uuid[]) AND c.status='待分配'
          AND ($2::uuid IS NULL OR (SELECT t.priority < prior_task.priority OR
            (t.priority=prior_task.priority AND (tc.created_at,c.id)>(prior_link.created_at,prior_link.case_id))
            FROM task_cases prior_link JOIN tasks prior_task ON prior_task.id=prior_link.task_id
            WHERE prior_link.case_id=$2 AND prior_link.deleted_at IS NULL)) AND c.source=t.source AND c.system_code=t.system_code
          AND NOT EXISTS (SELECT 1 FROM task_assignments a WHERE a.case_id=c.id AND a.state='active' AND a.deleted_at IS NULL)
        ORDER BY t.priority DESC, tc.created_at, c.id LIMIT 2000 FOR UPDATE OF c`, [autoTasks.map((t: { id: string }) => t.id), after]);
      const loads = await manager.query(`SELECT a.assignee_id, tc.task_id, count(*)::int n
        FROM task_assignments a JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
        JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
        JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.state='active' AND (a.due_at IS NULL OR a.due_at>clock_timestamp())
        GROUP BY a.assignee_id, tc.task_id`);
      const global = new Map<string, number>(), local = new Map<string, number>();
      for (const load of loads) { global.set(load.assignee_id, (global.get(load.assignee_id) ?? 0) + load.n); local.set(`${load.assignee_id}:${load.task_id}`, load.n); }
      const assigned: { case_id: string; task_id: string; assignee_id: string }[] = [];
      const unassigned: { case_id: string; reason: string }[] = [];
      for (const item of cases) {
        const task = autoTasks.find((t: { id: string }) => t.id === item.task_id);
        const eligible = users.filter(u => this.enabled(u) && u.quals[task.system_code]?.includes('annotate') &&
          (task.review_mode !== 'self' || u.quals[task.system_code]?.includes('review')));
        const available = eligible.filter(u => (u.in_flight_limit === null || (global.get(u.id) ?? 0) < u.in_flight_limit) &&
          (task.in_flight_limit === null || (local.get(`${u.id}:${task.id}`) ?? 0) < task.in_flight_limit));
        available.sort((a, b) => (global.get(a.id) ?? 0) - (global.get(b.id) ?? 0) ||
          (local.get(`${a.id}:${task.id}`) ?? 0) - (local.get(`${b.id}:${task.id}`) ?? 0) || a.id.localeCompare(b.id));
        const user = available[0];
        if (!user) { unassigned.push({ case_id: item.id, reason: eligible.length ? 'capacity_full' : 'no_eligible_assignee' }); continue; }
        await manager.query(`INSERT INTO task_assignments (case_id,assignee_id,task_role,due_at,state) VALUES ($1,$2,'annotate',NULL,'active')`, [item.id, user.id]);
        await manager.query(`UPDATE cases SET status='标注中', updated_at=now() WHERE id=$1`, [item.id]);
        const assignment = { case_id: item.id as string, task_id: task.id as string, assignee_id: user.id };
        await this.audit(manager, actor, 'tasks.dispatched', `tasks:${task.id}`, { ...assignment, mode: 'auto', from: '待分配', to: '标注中', due_at: null, task_role: 'annotate' }, ip);
        assigned.push(assignment); global.set(user.id, (global.get(user.id) ?? 0) + 1);
        local.set(`${user.id}:${task.id}`, (local.get(`${user.id}:${task.id}`) ?? 0) + 1);
      }
      return { assigned, unassigned, next_case_id: cases.length === 2000 ? cases[cases.length - 1].id as string : null };
    });
  }

  async reclaim(actor: AuthUser, body: unknown, ip: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const input = this.object(body, ['assignment_id', 'reason']), id = this.id(input.assignment_id);
    if (!['overdue', 'quality'].includes(input.reason as string)) throw new BadRequestException('回收原因无效');
    const [snapshot] = await this.db.query(`SELECT a.assignee_id, a.case_id, tc.task_id FROM task_assignments a
      JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL WHERE a.id=$1 AND a.deleted_at IS NULL`, [id]);
    if (!snapshot) throw new NotFoundException('分派不存在');
    return this.db.transaction(async manager => {
      await this.lockUsers(manager, actor, snapshot.assignee_id);
      const task = await this.task(manager, snapshot.task_id);
      const [item] = await manager.query('SELECT * FROM cases WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [snapshot.case_id]);
      const [assignment] = await manager.query(`SELECT *, (due_at IS NOT NULL AND due_at<=clock_timestamp()) overdue
        FROM task_assignments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const links = await manager.query('SELECT id FROM task_cases WHERE case_id=$1 AND task_id=$2 AND deleted_at IS NULL', [snapshot.case_id, task.id]);
      if (!assignment || assignment.state !== 'active' || assignment.task_role !== 'annotate' || !item ||
          item.status !== '标注中' || item.source !== task.source || item.system_code !== task.system_code || !links.length ||
          assignment.assignee_id !== snapshot.assignee_id) throw new ConflictException('分派或病例状态已变化');
      if (input.reason === 'overdue' && !assignment.overdue) throw new ConflictException('分派尚未逾期');
      await manager.query("UPDATE task_assignments SET state='released', updated_at=now() WHERE id=$1", [id]);
      await manager.query("UPDATE cases SET status='待分配', updated_at=now() WHERE id=$1", [item.id]);
      await this.audit(manager, actor, 'tasks.reclaimed', `tasks:${task.id}`, { assignment_id: id, case_id: item.id,
        assignee_id: assignment.assignee_id, reason: input.reason, from: '标注中', to: '待分配' }, ip);
      return { assignment_id: id, case_id: item.id as string, task_id: task.id as string, dispatch_mode: task.dispatch_mode as string, state: 'released' };
    });
  }

  private actor(users: CapacityUser[], actor: AuthUser, admin: boolean): void {
    const current = users.find(user => user.id === actor.id);
    if (!current || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new UnauthorizedException('会话已失效，请重新登录');
    if ((admin && current.role !== 'admin') || !this.enabled(current)) throw new ForbiddenException('账号不可用');
  }

  private async lockUsers(manager: EntityManager, actor: AuthUser, target?: string, member = false): Promise<CapacityUser[]> {
    if (!member && actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const users = await manager.query(`SELECT id, role, quals, status, expire_at::text, must_change_password,
      mfa_secret_encrypted, updated_at, in_flight_limit FROM users
      WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [[actor.id, ...(target ? [target] : [])]]) as CapacityUser[];
    this.actor(users, actor, !member);
    return users;
  }

  private enabled(user: CapacityUser): boolean {
    return user.status === 'active' && user.expire_at >= new Date().toISOString().slice(0, 10) &&
      !user.must_change_password && (user.role !== 'admin' || !!user.mfa_secret_encrypted);
  }

  private async task(manager: EntityManager, id: string) {
    const [task] = await manager.query('SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!task) throw new NotFoundException('任务不存在');
    if (task.status !== '进行中') throw new ConflictException('任务不在进行中');
    return task;
  }

  private object(body: unknown, fields: string[]): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
      throw new BadRequestException('请求字段无效');
    }
    return body as Record<string, unknown>;
  }

  private id(value: unknown): string {
    if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException('标识必须是 UUID');
    return value.toLowerCase();
  }

  private limit(value: unknown): void {
    if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 2147483647)) {
      throw new BadRequestException('在途上限须为正整数或 null');
    }
  }

  private async audit(manager: EntityManager, actor: AuthUser, action: string, target: string, detail: unknown, ip: string) {
    await manager.query('INSERT INTO audit_logs (actor, action, target, detail, ip) VALUES ($1,$2,$3,$4::jsonb,$5)',
      [actor.id, action, target, JSON.stringify(detail), ip]);
  }
}
