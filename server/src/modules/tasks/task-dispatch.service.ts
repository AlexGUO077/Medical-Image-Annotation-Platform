import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CapacityUser = AuthUser & { in_flight_limit: number | null };

@Injectable()
export class TaskDispatchService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource) {}

  async dispatch(actor: AuthUser, body: unknown, ip: string) {
    const input = this.object(body, ['mode', 'task_id', 'assignee_id', 'case_ids', 'due_at']);
    if (input.mode !== 'manual') throw new BadRequestException('本接口当前仅支持手动指派');
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
      const users = await this.lockUsers(manager, actor, assigneeId);
      const assignee = users.find(user => user.id === assigneeId);
      if (!assignee) throw new NotFoundException('承接人不存在');
      if (!this.enabled(assignee)) throw new ForbiddenException('承接人账号不可用');
      const task = await this.task(manager, taskId);
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
      await this.audit(manager, actor, 'tasks.dispatched', `tasks:${taskId}`, { ...result, mode: 'manual', from: '待分配', to: '标注中' }, ip);
      return result;
    });
  }

  async settings(actor: AuthUser, id: string, body: unknown, ip: string) {
    const taskId = this.id(id), input = this.object(body, ['priority', 'in_flight_limit']);
    if (!Object.keys(input).length) throw new BadRequestException('没有可更新字段');
    if ('priority' in input && (typeof input.priority !== 'number' || !Number.isInteger(input.priority) ||
        input.priority < -2147483648 || input.priority > 2147483647)) throw new BadRequestException('优先级无效');
    if ('in_flight_limit' in input) this.limit(input.in_flight_limit);
    return this.db.transaction(async manager => {
      await this.lockUsers(manager, actor);
      const task = await this.task(manager, taskId);
      const priority = 'priority' in input ? input.priority : task.priority;
      const limit = 'in_flight_limit' in input ? input.in_flight_limit : task.in_flight_limit;
      await manager.query('UPDATE tasks SET priority=$2, in_flight_limit=$3, updated_at=now() WHERE id=$1', [taskId, priority, limit]);
      const result = { id: taskId, priority, in_flight_limit: limit };
      await this.audit(manager, actor, 'tasks.settings_updated', `tasks:${taskId}`,
        { before: { priority: task.priority, in_flight_limit: task.in_flight_limit }, after: result }, ip);
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

  private async lockUsers(manager: EntityManager, actor: AuthUser, target?: string): Promise<CapacityUser[]> {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    const users = await manager.query(`SELECT id, role, quals, status, expire_at::text, must_change_password,
      mfa_secret_encrypted, updated_at, in_flight_limit FROM users
      WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [[actor.id, ...(target ? [target] : [])]]) as CapacityUser[];
    const current = users.find(user => user.id === actor.id);
    if (!current || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new UnauthorizedException('会话已失效，请重新登录');
    if (current.role !== 'admin' || !this.enabled(current)) throw new ForbiddenException('管理员账号不可用');
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
