import { ServiceUnavailableException } from '@nestjs/common';
import { loadDependencies, type DependencyTarget } from './dependency.config';
import { HealthService } from './health.service';
import type { PortProbe } from './port-probe.service';

const dependencies: DependencyTarget[] = [
  { name: 'postgres', host: 'postgres.internal.test', port: 5432 },
  { name: 'orthanc', host: 'orthanc.internal.test', port: 8042 },
  { name: 'minio', host: 'minio.internal.test', port: 9000 },
  { name: 'redis', host: 'redis.internal.test', port: 6379 },
  { name: 'elasticsearch', host: 'elasticsearch.internal.test', port: 9200 }
];

const configuredEnvironment: NodeJS.ProcessEnv = {
  POSTGRES_HOST: 'postgres.internal.test',
  POSTGRES_PORT: '5432',
  ORTHANC_HOST: 'orthanc.internal.test',
  ORTHANC_PORT: '8042',
  MINIO_HOST: 'minio.internal.test',
  MINIO_PORT: '9000',
  REDIS_HOST: 'redis.internal.test',
  REDIS_PORT: '6379',
  ELASTICSEARCH_HOST: 'elasticsearch.internal.test',
  ELASTICSEARCH_PORT: '9200'
};

class SuccessfulPortProbe implements PortProbe {
  readonly checked: DependencyTarget[] = [];

  async check(target: DependencyTarget): Promise<void> {
    this.checked.push(target);
  }
}

class FailingPortProbe implements PortProbe {
  async check(target: DependencyTarget): Promise<void> {
    if (target.name === 'orthanc') {
      throw new Error('connect ECONNREFUSED orthanc.internal.test:8042 socket detail');
    }
  }
}

describe('HealthService', () => {
  it('returns every dependency as up when all probes succeed in the configured order', async () => {
    const probe = new SuccessfulPortProbe();
    const service = new HealthService(probe, dependencies);

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: {
        postgres: 'up',
        orthanc: 'up',
        minio: 'up',
        redis: 'up',
        elasticsearch: 'up'
      }
    });
    expect(probe.checked.map((target) => target.name)).toEqual([
      'postgres',
      'orthanc',
      'minio',
      'redis',
      'elasticsearch'
    ]);
  });

  it('returns a generic 503 when a dependency probe fails', async () => {
    const service = new HealthService(new FailingPortProbe(), dependencies);

    await expect(service.ready()).rejects.toMatchObject({ status: 503 });

    try {
      await service.ready();
      expect.unreachable('readiness should reject when Orthanc is unavailable');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = JSON.stringify((error as ServiceUnavailableException).getResponse());
      expect(response).toContain('orthanc');
      expect(response).not.toContain('orthanc.internal.test');
      expect(response).not.toContain('8042');
      expect(response).not.toContain('socket detail');
    }
  });

  it('fails fast with the missing configuration key and no environment value', () => {
    expect(() => loadDependencies({})).toThrow(/POSTGRES_HOST/);
  });

  it.each([
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'ORTHANC_HOST',
    'ORTHANC_PORT',
    'MINIO_HOST',
    'MINIO_PORT',
    'REDIS_HOST',
    'REDIS_PORT',
    'ELASTICSEARCH_HOST',
    'ELASTICSEARCH_PORT'
  ])('reports only the missing configuration key %s', (missingKey) => {
    const environment = { ...configuredEnvironment, [missingKey]: undefined };

    expect(() => loadDependencies(environment)).toThrow(
      `Invalid dependency configuration: ${missingKey}`
    );
  });

  it.each([
    ['POSTGRES_HOST', ' private-postgres.internal.test'],
    ['POSTGRES_PORT', 'not-a-port'],
    ['ORTHANC_PORT', '65536']
  ])('reports only an invalid configuration key %s', (key, invalidValue) => {
    const environment = { ...configuredEnvironment, [key]: invalidValue };

    expect(() => loadDependencies(environment)).toThrow(`Invalid dependency configuration: ${key}`);
  });
});
