import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { requiredEnv } from '../../config/environment';

@Injectable()
export class TotpService {
  async createSetup(username: string): Promise<{
    encryptedSecret: string;
    qrCodeDataUrl: string;
    manualKey: string;
  }> {
    const secret = generateSecret();
    const uri = generateURI({ issuer: '医学影像标注平台', label: username, secret });
    return {
      encryptedSecret: this.encrypt(secret),
      qrCodeDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }),
      manualKey: secret,
    };
  }

  async verify(encryptedSecret: string, token: string): Promise<number> {
    if (!/^\d{6}$/.test(token)) throw new UnauthorizedException('动态验证码无效');
    const result = await verify({
      secret: this.decrypt(encryptedSecret),
      token,
      epochTolerance: 30,
    });
    if (!result.valid || !('timeStep' in result)) {
      throw new UnauthorizedException('动态验证码无效');
    }
    return result.timeStep;
  }

  private encrypt(value: string): string {
    const key = this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, encrypted].map((part) =>
      typeof part === 'string' ? part : part.toString('base64url')).join('.');
  }

  private decrypt(value: string): string {
    const [version, ivText, tagText, encryptedText, ...extra] = value.split('.');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText || extra.length > 0) {
      throw new Error('Invalid encrypted MFA secret');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private encryptionKey(): Buffer {
    const key = Buffer.from(requiredEnv('MFA_ENCRYPTION_KEY'), 'base64url');
    if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes');
    return key;
  }
}
