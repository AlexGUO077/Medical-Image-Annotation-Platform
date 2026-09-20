import { describe, expect, it, vi } from 'vitest';
import { SecurityStateService } from './security-state.service';

describe('SecurityStateService', () => {
  it('blocks the sixth authentication attempt inside the rate-limit window', async () => {
    const redis = { incr: vi.fn().mockResolvedValue(6), expire: vi.fn() };
    const service = new SecurityStateService(redis as never);

    await expect(service.assertAttemptAllowed('mfa', 'admin-1')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('accepts a TOTP time step only once', async () => {
    const redis = { set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null) };
    const service = new SecurityStateService(redis as never);

    await expect(service.consumeTotp('admin-1', 123)).resolves.toBe(true);
    await expect(service.consumeTotp('admin-1', 123)).resolves.toBe(false);
  });
});
