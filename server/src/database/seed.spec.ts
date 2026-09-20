import { describe, expect, it } from 'vitest';
import { hashSeedPassword } from './password';

describe('hashSeedPassword', () => {
  it('stores a salted scrypt hash instead of the seed password', () => {
    const password = 'SyntheticOnly-Password-2026';
    const first = hashSeedPassword(password, Buffer.alloc(16, 1));
    const second = hashSeedPassword(password, Buffer.alloc(16, 2));

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toContain(password);
    expect(first).not.toBe(second);
  });
});
