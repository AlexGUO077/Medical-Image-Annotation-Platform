import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { hashPassword } from '../../database/password';
import type { AccountRole, AuthUser, Qualification, Qualifications } from '../auth/auth.models';
import { accountAvailable, releaseIneligibleAnnotations } from '../tasks/assignment-release';
import { DATABASE_SOURCE } from '../database/database.tokens';

const SYSTEM_CODES = new Set(['cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone']);
const QUALIFICATIONS = new Set<Qualification>(['annotate', 'review']);

interface CreateUserInput {
  realName: string;
  email: string | null;
  phone: string | null;
  role: AccountRole;
  quals: Qualifications;
  expireAt: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE_SOURCE) private readonly dataSource: DataSource) {}

  async list(actor: AuthUser, query: Record<string, unknown>) {
    if (Object.keys(query).some(key => !['page', 'pageSize'].includes(key))) throw new BadRequestException('查询参数无效');
    const page = this.pageNumber(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.pageNumber(query.pageSize, 20, 1, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new BadRequestException('分页参数无效');
    return this.dataSource.transaction(async manager => {
      await this.currentAdmin(manager, actor);
      const [result] = await manager.query(`WITH rows AS MATERIALIZED (
        SELECT id,username,real_name,email,phone,role,quals,status,expire_at::text AS expire_at,
          must_change_password,(mfa_secret_encrypted IS NOT NULL) AS mfa_enabled,created_at,updated_at,in_flight_limit
        FROM users WHERE deleted_at IS NULL)
        SELECT (SELECT count(*)::int FROM rows) total,
          COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at,x.id) FROM
          (SELECT * FROM rows ORDER BY created_at,id LIMIT $1 OFFSET $2)x),'[]'::jsonb) items`, [pageSize, offset]);
      return { ...result, page, pageSize };
    });
  }

  async create(actor: AuthUser, body: unknown, ip: string) {
    const input = this.createInput(body);
    const username = `u_${randomBytes(6).toString('hex')}`;
    const initialPassword = `Aa1!${randomBytes(15).toString('base64url')}`;
    const id = await this.dataSource.transaction(async (manager) => {
      await this.currentAdmin(manager, actor);
      const rows = await manager.query(
        `INSERT INTO "users" (
          "username", "password_hash", "real_name", "email", "phone", "role", "quals",
          "status", "expire_at", "must_change_password"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active', $8, true)
        RETURNING "id"`,
        [
          username, hashPassword(initialPassword), input.realName, input.email, input.phone,
          input.role, JSON.stringify(input.quals), input.expireAt,
        ],
      ) as Array<{ id: string }>;
      const userId = rows[0]?.id;
      if (!userId) throw new Error('Account creation returned no id');
      await this.currentAdmin(manager, actor);
      await manager.query(
        `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
         VALUES ($1, 'users.created', $2, $3::jsonb, $4)`,
        [actor.id, `users:${userId}`, JSON.stringify({ role: input.role, quals: input.quals, expire_at: input.expireAt }), ip],
      );
      return userId;
    });
    return {
      id,
      username,
      initial_password: initialPassword,
      must_change_password: true,
    };
  }

  async update(actor: AuthUser, body: unknown, ip: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('账号更新请求无效');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['id','status','expire_at','quals','reset_mfa'].includes(key)) ||
        (input.reset_mfa !== undefined && typeof input.reset_mfa !== 'boolean')) throw new BadRequestException('账号更新字段无效');
    if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new BadRequestException('账号 id 必须是 UUID');
    const id = input.id.toLowerCase();
    if (input.status !== undefined && !['active','disabled'].includes(input.status as string)) throw new BadRequestException('账号状态无效');
    if (id === actor.id && (input.status === 'disabled' || input.reset_mfa === true)) throw new ForbiddenException('管理员不能停用自己或重置自己的双因素认证');
    const quals = input.quals === undefined ? undefined : this.qualifications(input.quals);
    const expire = input.expire_at === undefined ? undefined : this.date(input.expire_at, 'expire_at');
    if (input.status === undefined && quals === undefined && expire === undefined && input.reset_mfa !== true) throw new BadRequestException('没有可更新字段');
    return this.dataSource.transaction(async manager => {
      // Serialize account changes with every dispatch and release path, including cross-admin requests.
      const rows = await manager.query(`SELECT id,role,status,quals,expire_at::text,must_change_password,mfa_secret_encrypted,updated_at
        FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [[actor.id, id]]) as AuthUser[];
      const current = rows.find(user => user.id === actor.id), target = rows.find(user => user.id === id);
      if (!current || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new UnauthorizedException('会话已失效，请重新登录');
      if (current.role !== 'admin' || !accountAvailable(current)) throw new ForbiddenException('管理员账号不可用');
      if (!target) throw new NotFoundException('账号不存在');
      if (input.reset_mfa === true && target.role !== 'admin') throw new BadRequestException('只有管理员账号具有双因素认证');
      const updates: string[] = [], values: unknown[] = [];
      const changes: Record<string, unknown> = {};
      const next = { ...target };
      if (input.status !== undefined) { next.status = input.status as AuthUser['status']; updates.push(`status=$${values.push(next.status)}`); changes.status = { before: target.status, after: next.status }; }
      if (expire !== undefined) { next.expire_at = expire; updates.push(`expire_at=$${values.push(expire)}`); changes.expire_at = { before: target.expire_at, after: expire }; }
      if (quals !== undefined) { next.quals = quals; updates.push(`quals=$${values.push(JSON.stringify(quals))}::jsonb`); changes.quals = { before: target.quals, after: quals }; }
      if (input.reset_mfa === true) { next.mfa_secret_encrypted = null; updates.push('mfa_secret_encrypted=NULL'); changes.mfa_reset = true; }
      await manager.query(`UPDATE users SET ${updates.join(',')},updated_at=now() WHERE id=$${values.push(id)}`, values);
      const released = await releaseIneligibleAnnotations(manager, next, actor.id, ip);
      await manager.query(`INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES ($1,'users.updated',$2,$3::jsonb,$4)`,
        [actor.id, `users:${id}`, JSON.stringify(changes), ip]);
      return { id, updated: true, released_assignments: released.length };
    });
  }

  private createInput(body: unknown): CreateUserInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('账号创建请求无效');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['real_name','email','phone','role','quals','expire_at'].includes(key))) throw new BadRequestException('账号创建字段无效');
    if (typeof input.real_name !== 'string' || input.real_name.trim().length === 0) {
      throw new BadRequestException('real_name 必填');
    }
    if (input.role !== 'admin' && input.role !== 'member') throw new BadRequestException('role 无效');
    return {
      realName: input.real_name.trim(),
      email: this.optionalString(input.email),
      phone: this.optionalString(input.phone),
      role: input.role,
      quals: this.qualifications(input.quals ?? {}),
      expireAt: this.date(input.expire_at, 'expire_at'),
    };
  }

  private qualifications(value: unknown): Qualifications {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('quals 必须是对象');
    }
    const result: Qualifications = {};
    for (const [system, entries] of Object.entries(value)) {
      if (!SYSTEM_CODES.has(system) || !Array.isArray(entries)) throw new BadRequestException('quals 包含无效系统或格式');
      const qualifications = [...new Set(entries)];
      if (qualifications.some((entry) => typeof entry !== 'string' || !QUALIFICATIONS.has(entry as Qualification))) {
        throw new BadRequestException('quals 包含无效资格');
      }
      result[system] = qualifications as Qualification[];
    }
    return result;
  }

  private date(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) {
      throw new BadRequestException(`${field} 必须是 YYYY-MM-DD`);
    }
    return value;
  }

  private optionalString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('可选联系方式必须是字符串');
    return value.trim();
  }

  private pageNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new BadRequestException('分页参数无效');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException('分页参数无效');
    return parsed;
  }

  private async currentAdmin(manager: EntityManager, actor: AuthUser) {
    const [current] = await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [actor.id]) as AuthUser[];
    if (!current || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new UnauthorizedException('会话已失效，请重新登录');
    if (current.role !== 'admin' || !accountAvailable(current)) throw new ForbiddenException('管理员账号不可用');
  }
}
