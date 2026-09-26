import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { REDIS_CLIENT } from '../redis/redis.module';
afterEach(() => vi.unstubAllEnvs());
describe('case module dependency wiring', () => {
  it('resolves authenticated controllers with the application module', async () => {
    for (const key of ['JWT_SECRET', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) vi.stubEnv(key, 'synthetic-module-test');
    const { AppModule } = await import('../../app.module');
    const { CasesController } = await import('./cases.controller');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_SOURCE).useValue({})
      .overrideProvider(REDIS_CLIENT).useValue({})
      .compile();
    expect(module.get(CasesController)).toBeDefined();
    await module.close();
  });
});
