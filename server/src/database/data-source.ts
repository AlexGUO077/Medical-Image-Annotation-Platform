import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { requiredEnv } from '../config/environment';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? '5432'),
  username: requiredEnv('POSTGRES_USER'),
  password: requiredEnv('POSTGRES_PASSWORD'),
  database: requiredEnv('POSTGRES_DB'),
  synchronize: false,
  logging: false,
  migrationsTableName: 'typeorm_migrations',
  migrations: [resolve(__dirname, 'migrations', '[0-9]*{.ts,.js}')],
});
