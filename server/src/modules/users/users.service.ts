import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { hashPassword } from '../../database/password';
import type { AccountRole, AuthUser, Qualification, Qualifications } from '../auth/auth.models';
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

  async list(pageValue: unknown, pageSizeValue: unknown) {
    const page = this.pageNumber(pageValue, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.pageNumber(pageSizeValue, 20, 1, 100);
    const offset = (page - 1) * pageSize;
    const [items, totals] = await Promise.all([
      this.dataSource.query(
        `SELECT "id", "username", "real_name", "email", "phone", "role", "quals", "status",
                "expire_at"::text AS "expire_at", "must_change_password", ("mfa_secret_encrypted" IS NOT NULL) AS "mfa_enabled",
                "created_at", "updated_at"
         FROM "users" WHERE "deleted_at" IS NULL
         ORDER BY "created_at", "id" LIMIT $1 OFFSET $2`,
        [pageSize, offset],
      ),
      this.dataSource.query(
        'SELECT count(*)::int AS "total" FROM "users" WHERE "deleted_at" IS NULL',
      ) as Promise<Array<{ total: number }>>,
    ]);
    return { items, page, pageSize, total: totals[0]?.total ?? 0 };
  }

  async create(actor: AuthUser, body: unknown, ip: string) {
    const input = this.createInput(body);
    const username = `u_${randomBytes(6).toString('hex')}`;
    const initialPassword = `Aa1!${randomBytes(15).toString('base64url')}`;
    const id = await this.dataSource.transaction(async (manager) => {
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
    if (!body || typeof body !== 'object') throw new BadRequestException('账号更新请求无效');
    const input = body as Record<string, unknown>;
    if (typeof input.id !== 'string') throw new BadRequestException('账号 id 必填');
    const targetRows = await this.dataSource.query(
      `SELECT "id", "role", "status", "quals", "expire_at"::text AS "expire_at", "mfa_secret_encrypted"
       FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [input.id],
    ) as Array<{
      id: string;
      role: AccountRole;
      status: string;
      quals: Qualifications;
      expire_at: string;
      mfa_secret_encrypted: string | null;
    }>;
    const target = targetRows[0];
    if (!target) throw new NotFoundException('账号不存在');

    const updates: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, unknown> = {};
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'disabled') throw new BadRequestException('账号状态无效');
      updates.push(`"status" = $${values.push(input.status)}`);
      changes.status = { before: target.status, after: input.status };
    }
    if (input.expire_at !== undefined) {
      const expireAt = this.date(input.expire_at, 'expire_at');
      updates.push(`"expire_at" = $${values.push(expireAt)}`);
      changes.expire_at = { before: target.expire_at, after: expireAt };
    }
    if (input.quals !== undefined) {
      const quals = this.qualifications(input.quals);
      updates.push(`"quals" = $${values.push(JSON.stringify(quals))}::jsonb`);
      changes.quals = { before: target.quals, after: quals };
    }
    if (input.reset_mfa === true) {
      if (target.role !== 'admin') throw new BadRequestException('只有管理员账号具有双因素认证');
      if (target.id === actor.id) throw new ForbiddenException('管理员不能通过接口重置自己的双因素认证');
      updates.push('"mfa_secret_encrypted" = NULL');
      changes.mfa_reset = true;
    }
    if (updates.length === 0) throw new BadRequestException('没有可更新字段');

    values.push(target.id);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "users" SET ${updates.join(', ')}, "updated_at" = now()
         WHERE "id" = $${values.length} AND "deleted_at" IS NULL`,
        values,
      );
      await manager.query(
        `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
         VALUES ($1, 'users.updated', $2, $3::jsonb, $4)`,
        [actor.id, `users:${target.id}`, JSON.stringify(changes), ip],
      );
    });
    return { id: target.id, updated: true };
  }

  private createInput(body: unknown): CreateUserInput {
    if (!body || typeof body !== 'object') throw new BadRequestException('账号创建请求无效');
    const input = body as Record<string, unknown>;
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
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
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
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException('分页参数无效');
    return parsed;
  }
}
