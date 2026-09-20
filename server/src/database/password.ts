import { randomBytes, scryptSync } from 'node:crypto';

export function hashSeedPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
