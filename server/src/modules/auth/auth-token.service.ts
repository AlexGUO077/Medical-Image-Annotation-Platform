import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthClaims, AuthUser, TokenPurpose } from './auth.models';

@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(user: AuthUser): string {
    return this.sign(user, 'access', '8h');
  }

  signChallenge(
    user: AuthUser,
    purpose: Exclude<TokenPurpose, 'access'>,
    additional: Partial<AuthClaims> = {},
  ): string {
    return this.sign(user, purpose, '5m', additional);
  }

  verify(token: string, allowedPurposes: readonly TokenPurpose[]): AuthClaims {
    try {
      const claims = this.jwt.verify<AuthClaims>(token, {
        issuer: 'medical-image-annotation-platform',
        audience: 'web-anno',
      });
      if (!allowedPurposes.includes(claims.purpose)) throw new Error('wrong token purpose');
      return claims;
    } catch {
      throw new UnauthorizedException('认证信息无效或已过期');
    }
  }

  private sign(
    user: AuthUser,
    purpose: TokenPurpose,
    expiresIn: '5m' | '8h',
    additional: Partial<AuthClaims> = {},
  ): string {
    return this.jwt.sign(
      {
        role: user.role,
        quals: user.quals,
        account_updated_at: user.updated_at.getTime(),
        purpose,
        ...additional,
      },
      {
        subject: user.id,
        issuer: 'medical-image-annotation-platform',
        audience: 'web-anno',
        expiresIn,
      },
    );
  }
}
