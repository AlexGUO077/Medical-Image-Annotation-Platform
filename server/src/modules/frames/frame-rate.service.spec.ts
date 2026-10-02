import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { FrameRateService } from './frame-rate.service';
beforeEach(() => {
  vi.stubEnv('FRAME_RATE_WINDOW_SECONDS', '60');
  for (const m of ['CR','DX','US']) vi.stubEnv(`FRAME_RATE_${m}`, '2');
  for (const m of ['CT','MR']) vi.stubEnv(`FRAME_RATE_${m}`, '4');
});
afterEach(() => vi.unstubAllEnvs());
describe('frame rate configuration and Redis boundary', () => {
  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254741'])('fails closed for invalid window %s', value => {
    vi.stubEnv('FRAME_RATE_WINDOW_SECONDS', value);
    expect(() => new FrameRateService({} as never).configuration()).toThrow(ServiceUnavailableException);
  });
  it.each(['CR','DX','CT','MR','US'])('requires an explicit positive %s quota', modality => {
    vi.stubEnv(`FRAME_RATE_${modality}`, '');
    expect(() => new FrameRateService({} as never).configuration()).toThrow(ServiceUnavailableException);
  });
  it('requires both CT and MR to exceed both flat-image limits', () => {
    vi.stubEnv('FRAME_RATE_DX', '4');
    expect(() => new FrameRateService({} as never).configuration()).toThrow(ServiceUnavailableException);
  });
  it('separates read, ticket, case and account-version counters and honors the exact quota', async () => {
    const evalCall = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValue(1);
    const service = new FrameRateService({ eval: evalCall } as never);
    const version = new Date(1000);
    expect(await service.allow('user', 'case', version, 'CR', 'ticket')).toBe(true);
    expect(await service.allow('user', 'case', version, 'CR', 'ticket')).toBe(false);
    await service.allow('user', 'case', version, 'CR', 'read');
    await service.allow('user', 'other-case', version, 'CR', 'read');
    await service.allow('user', 'case', new Date(2000), 'CR', 'read');
    const keys = evalCall.mock.calls.map(call => call[1].keys[0]);
    expect(keys[0]).toBe(keys[1]); expect(new Set(keys).size).toBe(4);
  });
  it('denies on Redis failure or unexpected counter values', async () => {
    for (const value of [null, '1', 0]) {
      const service = new FrameRateService({ eval: vi.fn().mockResolvedValue(value) } as never);
      await expect(service.allow('u','c',new Date(),'CR','read')).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
    const service = new FrameRateService({ eval: vi.fn().mockRejectedValue(new Error('private Redis detail')) } as never);
    await expect(service.allow('u','c',new Date(),'CR','read')).rejects.toThrow('帧限流服务不可用');
  });
});
