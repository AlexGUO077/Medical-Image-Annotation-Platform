import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';

const modalities = ['CR', 'DX', 'CT', 'MR', 'US'] as const;
export type FrameModality = typeof modalities[number];
// INCR + first expiry must be atomic, including failures/restarts between commands.
const increment = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n`;

@Injectable()
export class FrameRateService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}
  configuration() {
    const window = Number(process.env.FRAME_RATE_WINDOW_SECONDS);
    const limits = Object.fromEntries(modalities.map(m => [m, Number(process.env[`FRAME_RATE_${m}`])])) as Record<FrameModality, number>;
    if (!Number.isSafeInteger(window) || window <= 0 || !Number.isSafeInteger(window * 1000) ||
        modalities.some(m => !Number.isSafeInteger(limits[m]) || limits[m] <= 0) ||
        Math.min(limits.CT, limits.MR) <= Math.max(limits.CR, limits.DX)) {
      throw new ServiceUnavailableException('帧限流配置尚未就绪');
    }
    return { window, limits };
  }
  async allow(userId: string, caseId: string, version: Date, modality: FrameModality, phase: 'ticket' | 'read'): Promise<boolean> {
    const { window, limits } = this.configuration();
    if (!modalities.includes(modality)) throw new ServiceUnavailableException('帧模态不可用');
    // Separate admission/read counters prevent ticket replay from bypassing the read budget.
    // Account version changes start a new window without wildcard deletion or resetting other users.
    const digest = createHash('sha256').update(JSON.stringify([userId, caseId, version.getTime(), modality, phase])).digest('hex');
    try {
      const n = await this.redis.eval(increment, { keys: [`frames:rate:v1:${digest}`], arguments: [String(window * 1000)] });
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new Error('Invalid counter');
      return n <= limits[modality];
    } catch { throw new ServiceUnavailableException('帧限流服务不可用'); }
  }
}
