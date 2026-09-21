import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class SecurityStateService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async assertAttemptAllowed(scope: 'password' | 'mfa', identifier: string): Promise<void> {
    const key = this.attemptKey(scope, identifier);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 15 * 60);
    if (count > 5) throw new HttpException('尝试次数过多，请稍后重试', 429);
  }

  async clearAttempts(scope: 'password' | 'mfa', identifier: string): Promise<void> {
    await this.redis.del(this.attemptKey(scope, identifier));
  }

  async consumeTotp(userId: string, timeStep: number): Promise<boolean> {
    const result = await this.redis.set(`auth:totp-used:${userId}:${timeStep}`, '1', {
      NX: true,
      EX: 90,
    });
    return result === 'OK';
  }

  private attemptKey(scope: string, identifier: string): string {
    const digest = createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');
    return `auth:attempt:${scope}:${digest}`;
  }
}
