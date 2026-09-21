import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { hashPassword, verifyPassword } from '../../database/password';
import { AuditService } from '../audit/audit.service';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { AuthTokenService } from './auth-token.service';
import type { AuthClaims, AuthUser } from './auth.models';
import { SecurityStateService } from './security-state.service';
import { TotpService } from './totp.service';

type NextStep = 'authenticated' | 'change_password' | 'setup_2fa' | 'verify_2fa';

const DUMMY_PASSWORD_HASH = hashPassword('timing-equalization-only', Buffer.alloc(16, 0x5a));

export interface AuthResponse {
  token: string;
  role: AuthUser['role'];
  quals: AuthUser['quals'];
  must_change_password: boolean;
  next: NextStep;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_SOURCE) private readonly dataSource: DataSource,
    private readonly tokens: AuthTokenService,
    private readonly totp: TotpService,
    private readonly securityState: SecurityStateService,
    private readonly audit: AuditService,
  ) {}

  async login(body: unknown, ip: string): Promise<AuthResponse> {
    const { username, password } = this.loginInput(body);
    const user = await this.findByUsername(username);
    await this.assertAttemptAllowed('password', username, user, ip);
    const passwordMatches = verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches || !this.isAccountUsable(user)) {
      if (user) await this.recordFailure(user, 'auth.login_failed', 'password', ip);
      throw new UnauthorizedException('用户名或密码错误');
    }
    await this.securityState.clearAttempts('password', username);

    if (user.must_change_password) return this.challenge(user, 'password_change', 'change_password', true);
    if (user.role === 'admin') {
      return user.mfa_secret_encrypted
        ? this.challenge(user, 'mfa_verify', 'verify_2fa', false)
        : this.challenge(user, 'mfa_setup', 'setup_2fa', false);
    }

    await this.audit.record(user.id, 'auth.login', `users:${user.id}`, { result: 'success' }, ip);
    return this.access(user);
  }

  async changePassword(authorization: string | undefined, body: unknown, ip: string): Promise<AuthResponse> {
    const claims = this.verifyBearer(authorization, ['password_change', 'access']);
    const { currentPassword, newPassword } = this.passwordInput(body);
    const user = await this.requireUsableUser(claims.sub);
    await this.assertAttemptAllowed('password', `change:${user.id}`, user, ip);
    if (!verifyPassword(currentPassword, user.password_hash)) {
      await this.recordFailure(user, 'auth.password_change_failed', 'password', ip);
      throw new UnauthorizedException('当前密码错误');
    }
    try {
      this.assertStrongPassword(newPassword, currentPassword);
    } catch (error) {
      await this.recordFailure(user, 'auth.password_change_failed', 'password_policy', ip);
      throw error;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "users"
         SET "password_hash" = $1, "must_change_password" = false, "updated_at" = now()
         WHERE "id" = $2 AND "deleted_at" IS NULL`,
        [hashPassword(newPassword), user.id],
      );
      await manager.query(
        `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
         VALUES ($1, 'auth.password_changed', $2, '{"result":"success"}'::jsonb, $3)`,
        [user.id, `users:${user.id}`, ip],
      );
    });
    await this.securityState.clearAttempts('password', `change:${user.id}`);

    const updated = await this.requireUsableUser(user.id);
    if (updated.role === 'admin') {
      return updated.mfa_secret_encrypted
        ? this.challenge(updated, 'mfa_verify', 'verify_2fa', false)
        : this.challenge(updated, 'mfa_setup', 'setup_2fa', false);
    }
    return this.access(updated);
  }

  async setupMfa(authorization: string | undefined): Promise<{
    token: string;
    qr_code_data_url: string;
    manual_key: string;
  }> {
    const claims = this.verifyBearer(authorization, ['mfa_setup']);
    const user = await this.requireUsableUser(claims.sub);
    if (user.role !== 'admin' || user.must_change_password || user.mfa_secret_encrypted) {
      throw new UnauthorizedException('当前账号不能绑定双因素认证');
    }
    const setup = await this.totp.createSetup(user.username);
    return {
      token: this.tokens.signChallenge(user, 'mfa_enroll', {
        mfa_secret_encrypted: setup.encryptedSecret,
      }),
      qr_code_data_url: setup.qrCodeDataUrl,
      manual_key: setup.manualKey,
    };
  }

  async verifyMfa(authorization: string | undefined, body: unknown, ip: string): Promise<AuthResponse> {
    const claims = this.verifyBearer(authorization, ['mfa_verify', 'mfa_enroll']);
    const user = await this.requireUsableUser(claims.sub);
    if (user.role !== 'admin' || user.must_change_password) {
      await this.recordFailure(user, 'auth.mfa_failed', 'account_state', ip);
      throw new UnauthorizedException('当前账号不能验证双因素认证');
    }
    if (claims.purpose === 'mfa_enroll' && user.mfa_secret_encrypted) {
      await this.recordFailure(user, 'auth.mfa_failed', 'enrollment_state', ip);
      throw new UnauthorizedException('双因素认证已经绑定');
    }
    await this.assertAttemptAllowed('mfa', user.id, user, ip);
    let encryptedSecret: string;
    try {
      const code = this.mfaCodeInput(body);
      const candidate = claims.purpose === 'mfa_enroll'
        ? claims.mfa_secret_encrypted
        : user.mfa_secret_encrypted;
      if (!candidate) throw new UnauthorizedException('尚未绑定双因素认证');
      encryptedSecret = candidate;
      const timeStep = await this.totp.verify(encryptedSecret, code);
      if (!await this.securityState.consumeTotp(user.id, timeStep)) {
        throw new UnauthorizedException('动态验证码已使用');
      }
    } catch (error) {
      await this.recordFailure(user, 'auth.mfa_failed', 'totp', ip);
      throw error;
    }
    await this.securityState.clearAttempts('mfa', user.id);

    let current = user;
    if (claims.purpose === 'mfa_enroll') {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE "users" SET "mfa_secret_encrypted" = $1, "updated_at" = now()
           WHERE "id" = $2 AND "deleted_at" IS NULL`,
          [encryptedSecret, user.id],
        );
        await manager.query(
          `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
           VALUES ($1, 'auth.mfa_enrolled', $2, '{"factor":"totp"}'::jsonb, $3)`,
          [user.id, `users:${user.id}`, ip],
        );
      });
      current = await this.requireUsableUser(user.id);
    } else {
      await this.audit.record(user.id, 'auth.login', `users:${user.id}`, { result: 'success', mfa: 'totp' }, ip);
    }
    return this.access(current);
  }

  async requireUsableUser(id: string): Promise<AuthUser> {
    const rows = await this.dataSource.query(
      `SELECT "id", "username", "password_hash", "real_name", "role", "quals", "status",
              "expire_at"::text AS "expire_at", "must_change_password", "mfa_secret_encrypted", "updated_at"
       FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [id],
    ) as AuthUser[];
    const user = rows[0];
    if (!user || !this.isAccountUsable(user)) throw new UnauthorizedException('账号不可用');
    return user;
  }

  private async findByUsername(username: string): Promise<AuthUser | undefined> {
    const rows = await this.dataSource.query(
      `SELECT "id", "username", "password_hash", "real_name", "role", "quals", "status",
              "expire_at"::text AS "expire_at", "must_change_password", "mfa_secret_encrypted", "updated_at"
       FROM "users" WHERE lower("username") = lower($1) AND "deleted_at" IS NULL`,
      [username],
    ) as AuthUser[];
    return rows[0];
  }

  private isAccountUsable(user: AuthUser): boolean {
    return user.status === 'active' && user.expire_at >= new Date().toISOString().slice(0, 10);
  }

  private async assertAttemptAllowed(
    scope: 'password' | 'mfa',
    identifier: string,
    user: AuthUser | undefined,
    ip: string,
  ): Promise<void> {
    try {
      await this.securityState.assertAttemptAllowed(scope, identifier);
    } catch (error) {
      if (user && error instanceof HttpException && error.getStatus() === 429) {
        await this.audit.record(
          user.id,
          'auth.locked_out',
          `users:${user.id}`,
          { result: 'blocked', scope },
          ip,
        );
      }
      throw error;
    }
  }

  private recordFailure(user: AuthUser, action: string, scope: string, ip: string): Promise<void> {
    return this.audit.record(
      user.id,
      action,
      `users:${user.id}`,
      { result: 'failure', scope },
      ip,
    );
  }

  private challenge(
    user: AuthUser,
    purpose: 'password_change' | 'mfa_setup' | 'mfa_verify',
    next: NextStep,
    mustChangePassword: boolean,
  ): AuthResponse {
    return {
      token: this.tokens.signChallenge(user, purpose),
      role: user.role,
      quals: user.quals,
      must_change_password: mustChangePassword,
      next,
    };
  }

  private access(user: AuthUser): AuthResponse {
    return {
      token: this.tokens.signAccess(user),
      role: user.role,
      quals: user.quals,
      must_change_password: false,
      next: 'authenticated',
    };
  }

  private verifyBearer(authorization: string | undefined, purposes: AuthClaims['purpose'][]): AuthClaims {
    const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new UnauthorizedException('缺少认证信息');
    return this.tokens.verify(token, purposes);
  }

  private loginInput(body: unknown): { username: string; password: string } {
    if (!body || typeof body !== 'object') throw new UnauthorizedException('用户名或密码错误');
    const input = body as Record<string, unknown>;
    if (typeof input.username !== 'string' || typeof input.password !== 'string') {
      throw new UnauthorizedException('用户名或密码错误');
    }
    return { username: input.username.trim(), password: input.password };
  }

  private passwordInput(body: unknown): { currentPassword: string; newPassword: string } {
    if (!body || typeof body !== 'object') throw new UnauthorizedException('密码请求无效');
    const input = body as Record<string, unknown>;
    if (typeof input.current_password !== 'string' || typeof input.new_password !== 'string') {
      throw new UnauthorizedException('密码请求无效');
    }
    return { currentPassword: input.current_password, newPassword: input.new_password };
  }

  private mfaCodeInput(body: unknown): string {
    if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).code !== 'string') {
      throw new UnauthorizedException('动态验证码无效');
    }
    return (body as { code: string }).code.trim();
  }

  private assertStrongPassword(password: string, currentPassword: string): void {
    if (
      password.length < 12 || password.length > 128 || password === currentPassword ||
      !/[A-Za-z]/.test(password) || !/\d/.test(password)
    ) throw new UnauthorizedException('新密码至少 12 位，并同时包含字母和数字');
  }
}
