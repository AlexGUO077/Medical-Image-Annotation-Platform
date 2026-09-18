export const HEALTH_DEPENDENCIES = Symbol('HEALTH_DEPENDENCIES');

export type DependencyName = 'postgres' | 'orthanc' | 'minio' | 'redis' | 'elasticsearch';

export interface DependencyTarget {
  name: DependencyName;
  host: string;
  port: number;
}

const dependencyConfiguration = [
  { name: 'postgres', hostKey: 'POSTGRES_HOST', portKey: 'POSTGRES_PORT' },
  { name: 'orthanc', hostKey: 'ORTHANC_HOST', portKey: 'ORTHANC_PORT' },
  { name: 'minio', hostKey: 'MINIO_HOST', portKey: 'MINIO_PORT' },
  { name: 'redis', hostKey: 'REDIS_HOST', portKey: 'REDIS_PORT' },
  { name: 'elasticsearch', hostKey: 'ELASTICSEARCH_HOST', portKey: 'ELASTICSEARCH_PORT' }
] as const satisfies ReadonlyArray<{
  name: DependencyName;
  hostKey: string;
  portKey: string;
}>;

function isValidHost(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value === value.trim();
}

function isValidPort(value: string | undefined): value is string {
  if (value === undefined || !/^\d+$/.test(value)) {
    return false;
  }

  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535;
}

function invalidConfiguration(key: string): never {
  throw new Error(`Invalid dependency configuration: ${key}`);
}

export function loadDependencies(env: NodeJS.ProcessEnv): DependencyTarget[] {
  return dependencyConfiguration.map(({ name, hostKey, portKey }) => {
    const host = env[hostKey];
    if (!isValidHost(host)) {
      return invalidConfiguration(hostKey);
    }

    const portValue = env[portKey];
    if (!isValidPort(portValue)) {
      return invalidConfiguration(portKey);
    }

    return { name, host, port: Number(portValue) };
  });
}
