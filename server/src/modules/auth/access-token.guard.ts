import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { AuthTokenService } from './auth-token.service';
import type { AuthenticatedRequest, AuthUser } from './auth.models';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(DATABASE_SOURCE) private readonly dataSource: DataSource,
    private readonly tokens: AuthTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new UnauthorizedException('缺少认证信息');
    const claims = this.tokens.verify(token, ['access']);
    const rows = await this.dataSource.query(
      `SELECT "id", "username", "password_hash", "real_name", "role", "quals", "status",
              "expire_at"::text AS "expire_at", "must_change_password", "mfa_secret_encrypted", "updated_at"
       FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [claims.sub],
    ) as AuthUser[];
    const user = rows[0];
    if (!user) throw new UnauthorizedException('认证信息无效');
    if (user.status !== 'active' || user.expire_at < new Date().toISOString().slice(0, 10)) {
      throw new ForbiddenException('账号已停用或过期');
    }
    if (user.must_change_password || (user.role === 'admin' && !user.mfa_secret_encrypted)) {
      throw new ForbiddenException('账号尚未完成安全设置');
    }
    if (claims.account_updated_at !== user.updated_at.getTime()) {
      throw new UnauthorizedException('会话已失效，请重新登录');
    }
    request.user = user;
    request.auth = claims;
    return true;
  }
}
