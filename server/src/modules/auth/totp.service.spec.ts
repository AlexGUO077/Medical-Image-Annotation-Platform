import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  it('creates a Microsoft Authenticator compatible setup and verifies its code', async () => {
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');
    const service = new TotpService();
    const setup = await service.createSetup('synthetic-admin');
    const code = await generate({ secret: setup.manualKey });

    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.encryptedSecret).not.toContain(setup.manualKey);
    await expect(service.verify(setup.encryptedSecret, code)).resolves.toEqual(expect.any(Number));
    await expect(service.verify(setup.encryptedSecret, 'abcdef')).rejects.toThrow('动态验证码无效');
  });
});
