import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export const hashSeedPassword = hashPassword;

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, n, r, p, saltText, expectedText, ...extra] = encoded.split('$');
  if (
    algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' ||
    !saltText || !expectedText || extra.length > 0
  ) return false;

  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(expectedText, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
