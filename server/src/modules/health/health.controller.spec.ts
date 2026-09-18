import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('returns the application liveness contract', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { ready: async () => undefined } }]
    }).compile();

    expect(module.get(HealthController).live()).toEqual({ status: 'ok', service: 'server' });
  });

  it('returns the readiness result supplied by the health service', async () => {
    const readiness = {
      status: 'ok' as const,
      dependencies: {
        postgres: 'up' as const,
        orthanc: 'up' as const,
        minio: 'up' as const,
        redis: 'up' as const,
        elasticsearch: 'up' as const
      }
    };
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { ready: async () => readiness } }]
    }).compile();

    await expect(module.get(HealthController).ready()).resolves.toEqual(readiness);
  });
});
