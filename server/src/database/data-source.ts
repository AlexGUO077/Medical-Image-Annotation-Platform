import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

config({
  path: process.env.MIAP_ENV_FILE ?? resolve(process.cwd(), '../.env.local'),
  quiet: true,
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? '5432'),
  username: required('POSTGRES_USER'),
  password: required('POSTGRES_PASSWORD'),
  database: required('POSTGRES_DB'),
  synchronize: false,
  logging: false,
  migrationsTableName: 'typeorm_migrations',
  migrations: [resolve(__dirname, 'migrations', '[0-9]*{.ts,.js}')],
});
