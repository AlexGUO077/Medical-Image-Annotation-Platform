import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';

export const APP_DATABASE_ROLE = 'miap_app';

const MUTABLE_TABLES = [
  'users', 'taxonomy_nodes', 'sign_tags', 'cases', 'studies', 'series', 'reports', 'attachments',
  'tasks', 'task_cases', 'task_assignments', 'annotation_objects', 'annotation_tags', 'reviews',
  'export_requests',
];

export async function provisionApplicationRole(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DATABASE_ROLE}') THEN
        CREATE ROLE "${APP_DATABASE_ROLE}" NOLOGIN;
      END IF;
    END $$
  `);
  await dataSource.query(`GRANT USAGE ON SCHEMA public TO "${APP_DATABASE_ROLE}"`);
  await dataSource.query(`REVOKE CREATE ON SCHEMA public FROM "${APP_DATABASE_ROLE}"`);
  await dataSource.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${MUTABLE_TABLES.map((table) => `"${table}"`).join(', ')} TO "${APP_DATABASE_ROLE}"`);
  await dataSource.query(`GRANT SELECT, INSERT ON "audit_logs" TO "${APP_DATABASE_ROLE}"`);
  await dataSource.query(`REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM "${APP_DATABASE_ROLE}"`);
  await dataSource.query(`REVOKE ALL ON "typeorm_migrations" FROM "${APP_DATABASE_ROLE}"`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await provisionApplicationRole(AppDataSource);
    console.log(`Database role ${APP_DATABASE_ROLE} provisioned with minimum application privileges.`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database role provisioning failed');
    process.exitCode = 1;
  });
}
