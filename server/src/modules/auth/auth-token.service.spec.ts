import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth.models';
import { AuthTokenService } from './auth-token.service';

const user: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  password_hash: 'unused',
  real_name: '合成管理员',
  role: 'admin',
  quals: {},
  status: 'active',
  expire_at: '2099-12-31',
  must_change_password: false,
  mfa_secret_encrypted: 'encrypted',
  updated_at: new Date('2026-09-20T00:00:00Z'),
};

describe('AuthTokenService', () => {
  it('separates five-minute challenge tokens from eight-hour access tokens', () => {
    const service = new AuthTokenService(new JwtService({ secret: 'x'.repeat(32) }));
    const challenge = service.signChallenge(user, 'mfa_verify');
    const access = service.signAccess(user);

    expect(service.verify(challenge, ['mfa_verify']).purpose).toBe('mfa_verify');
    expect(() => service.verify(challenge, ['access'])).toThrow('认证信息无效或已过期');
    const accessClaims = service.verify(access, ['access']);
    expect(accessClaims.exp! - accessClaims.iat!).toBe(8 * 60 * 60);
  });
});
