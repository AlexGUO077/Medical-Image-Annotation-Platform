import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { APP_DATABASE_ROLE } from './provision-role';

export const BUSINESS_TABLES = [
  'users', 'cases', 'studies', 'series', 'reports', 'attachments', 'taxonomy_nodes', 'sign_tags',
  'tasks', 'task_cases', 'task_assignments', 'annotation_objects', 'annotation_tags', 'reviews',
  'audit_logs', 'export_requests',
] as const;

type ExpectedColumn = readonly [dataType: string, nullable: boolean];

const EXPECTED_COLUMNS: Record<string, Record<string, ExpectedColumn>> = {
  users: {
    username: ['character varying', false], password_hash: ['character varying', false],
    real_name: ['character varying', false], email: ['character varying', true],
    phone: ['character varying', true], role: ['character varying', false],
    quals: ['jsonb', false], status: ['character varying', false], expire_at: ['date', false],
    must_change_password: ['boolean', false], mfa_secret_encrypted: ['character varying', true],
    in_flight_limit: ['integer', true],
  },
  cases: {
    case_no: ['character varying', false], status: ['character varying', false],
    source: ['character varying', false], system_code: ['character varying', false],
    disease_tag_id: ['uuid', true], clinical_text: ['text', true],
    age_band: ['character varying', true], sex: ['character varying', true],
    confirm_method: ['character varying', false], teaching_fields: ['jsonb', true],
  },
  studies: {
    case_id: ['uuid', false], study_uid: ['character varying', false], study_date: ['date', false],
  },
  series: {
    study_id: ['uuid', false], modality: ['character varying', false],
    series_uid: ['character varying', false], orthanc_id: ['character varying', false],
    frame_count: ['integer', false], default_window: ['jsonb', true],
  },
  reports: {
    case_id: ['uuid', false], raw_text: ['text', false], sentences: ['jsonb', false],
    mask_map_id: ['uuid', true],
  },
  attachments: {
    case_id: ['uuid', false], kind: ['character varying', false],
    object_key: ['character varying', false], filename: ['character varying', false],
    size: ['character varying', false], deid_confirmed: ['boolean', false],
  },
  taxonomy_nodes: {
    parent_id: ['uuid', true], level: ['integer', false], name: ['character varying', false],
    synonyms: ['jsonb', false], icd: ['character varying', true],
  },
  sign_tags: {
    name: ['character varying', false], system_code: ['character varying', false],
    definition: ['text', false],
  },
  tasks: {
    name: ['character varying', false], source: ['character varying', false],
    system_code: ['character varying', false], review_mode: ['character varying', false],
    dispatch_mode: ['character varying', false], priority: ['integer', false], status: ['character varying', false],
    in_flight_limit: ['integer', true],
  },
  task_cases: { task_id: ['uuid', false], case_id: ['uuid', false] },
  task_assignments: {
    case_id: ['uuid', false], assignee_id: ['uuid', false],
    task_role: ['character varying', false], due_at: ['timestamp with time zone', true],
    state: ['character varying', false],
  },
  annotation_objects: {
    case_id: ['uuid', false], series_id: ['uuid', false], tool: ['character varying', false],
    geometry: ['jsonb', false], frame_start: ['integer', false], frame_end: ['integer', false],
    window_preset: ['character varying', true], report_sent_ids: ['jsonb', false],
    part_id: ['uuid', false], confidence: ['character varying', false],
    measurements: ['jsonb', true], version: ['integer', false], is_gold: ['boolean', false],
    created_by: ['uuid', false], task_id: ['uuid', false],
  },
  annotation_tags: { annotation_id: ['uuid', false], sign_tag_id: ['uuid', false] },
  reviews: {
    case_id: ['uuid', false], reviewer_id: ['uuid', false],
    result: ['character varying', false], comments: ['jsonb', false],
    is_spotcheck: ['boolean', false],
  },
  audit_logs: {
    actor: ['uuid', false], action: ['character varying', false],
    target: ['character varying', false], detail: ['jsonb', false],
    ip: ['character varying', false],
  },
  export_requests: {
    status: ['character varying', false], approver_id: ['uuid', true],
    expire_at: ['timestamp with time zone', true], url: ['character varying', true],
  },
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function existingBusinessTables(dataSource: DataSource): Promise<string[]> {
  const rows = await dataSource.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [BUSINESS_TABLES],
  ) as Array<{ table_name: string }>;
  return rows.map(({ table_name }) => table_name);
}

export async function verifyDatabase(dataSource: DataSource): Promise<void> {
  const tables = await existingBusinessTables(dataSource);
  assert(tables.length === BUSINESS_TABLES.length, `Expected 16 business tables, found ${tables.length}`);

  const commonColumnRows = await dataSource.query(
    `SELECT count(*)::int AS count
     FROM (
       SELECT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
         AND column_name = ANY(ARRAY['id', 'created_at', 'updated_at', 'deleted_at'])
       GROUP BY table_name
       HAVING count(DISTINCT column_name) = 4
     ) complete_tables`,
    [BUSINESS_TABLES],
  ) as Array<{ count: number }>;
  assert(
    commonColumnRows[0]?.count === BUSINESS_TABLES.length,
    'A business table is missing a common audit column',
  );

  const columnRows = await dataSource.query(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
       AND column_name <> ALL(ARRAY['id', 'created_at', 'updated_at', 'deleted_at'])`,
    [BUSINESS_TABLES],
  ) as Array<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: 'YES' | 'NO';
  }>;
  const actualColumnCount = columnRows.length;
  const expectedColumnCount = Object.values(EXPECTED_COLUMNS)
    .reduce((count, columns) => count + Object.keys(columns).length, 0);
  assert(actualColumnCount === expectedColumnCount, 'Business field count differs from the manual contract');
  for (const column of columnRows) {
    const expected = EXPECTED_COLUMNS[column.table_name]?.[column.column_name];
    assert(expected !== undefined, `Unexpected field ${column.table_name}.${column.column_name}`);
    assert(expected[0] === column.data_type, `Wrong type for ${column.table_name}.${column.column_name}`);
    assert(expected[1] === (column.is_nullable === 'YES'), `Wrong nullability for ${column.table_name}.${column.column_name}`);
  }

  const seedRows = await dataSource.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE role = 'admin' AND deleted_at IS NULL) AS admins,
      (SELECT count(*)::int FROM taxonomy_nodes WHERE level = 1 AND deleted_at IS NULL) AS systems,
      (SELECT count(*)::int FROM taxonomy_nodes WHERE level = 2 AND name LIKE '合成示例部位-%' AND deleted_at IS NULL) AS parts,
      (SELECT count(*)::int FROM taxonomy_nodes WHERE level = 3 AND name LIKE '合成示例疾病-%' AND deleted_at IS NULL) AS diseases,
      (SELECT count(*)::int FROM taxonomy_nodes WHERE level = 4 AND name LIKE '合成示例分型-%' AND deleted_at IS NULL) AS subtypes,
      (SELECT count(*)::int FROM sign_tags WHERE name LIKE '合成示例征象-%' AND deleted_at IS NULL) AS signs
  `) as Array<{ admins: number; systems: number; parts: number; diseases: number; subtypes: number; signs: number }>;
  const seedCounts = seedRows[0];
  assert(seedCounts !== undefined, 'Seed verification query returned no result');
  assert(seedCounts.admins >= 1, 'Synthetic administrator seed is missing');
  assert(seedCounts.systems === 8, `Expected 8 system roots, found ${seedCounts.systems}`);
  assert(seedCounts.parts === 8, `Expected 8 synthetic level-2 nodes, found ${seedCounts.parts}`);
  assert(seedCounts.diseases === 8, `Expected 8 synthetic disease nodes, found ${seedCounts.diseases}`);
  assert(seedCounts.subtypes === 8, `Expected 8 synthetic level-4 nodes, found ${seedCounts.subtypes}`);
  assert(seedCounts.signs === 8, `Expected 8 synthetic sign tags, found ${seedCounts.signs}`);

  const indexRows = await dataSource.query(`
    SELECT
      to_regclass('public.users_quals_gin') IS NOT NULL AS quals_gin,
      to_regclass('public.annotation_objects_report_sent_ids_gin') IS NOT NULL AS report_sent_ids_gin
  `) as Array<{ quals_gin: boolean; report_sent_ids_gin: boolean }>;
  const indexes = indexRows[0];
  assert(indexes !== undefined, 'Index verification query returned no result');
  assert(indexes.quals_gin && indexes.report_sent_ids_gin, 'Required JSONB GIN index is missing');

  const triggerRows = await dataSource.query(`
    SELECT count(*)::int AS count
    FROM pg_trigger
    WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_append_only' AND NOT tgisinternal
  `) as Array<{ count: number }>;
  const auditTrigger = triggerRows[0];
  assert(auditTrigger !== undefined, 'Audit trigger verification query returned no result');
  assert(auditTrigger.count === 1, 'Append-only audit trigger is missing');

  const roleRows = await dataSource.query(
    `SELECT
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists,
      has_table_privilege($1, 'users', 'SELECT') AS can_read_users,
      has_table_privilege($1, 'audit_logs', 'INSERT') AS can_insert_audit,
      has_table_privilege($1, 'audit_logs', 'UPDATE') AS can_update_audit,
      has_table_privilege($1, 'typeorm_migrations', 'SELECT') AS can_read_migrations`,
    [APP_DATABASE_ROLE],
  ) as Array<{
    exists: boolean;
    can_read_users: boolean;
    can_insert_audit: boolean;
    can_update_audit: boolean;
    can_read_migrations: boolean;
  }>;
  const role = roleRows[0];
  assert(role !== undefined, 'Database role verification query returned no result');
  assert(role.exists, `Database role ${APP_DATABASE_ROLE} is missing`);
  assert(role.can_read_users, `${APP_DATABASE_ROLE} cannot read application tables`);
  assert(role.can_insert_audit && !role.can_update_audit, 'Audit log privileges are not append-only');
  assert(!role.can_read_migrations, `${APP_DATABASE_ROLE} can read migration metadata`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await verifyDatabase(AppDataSource);
    console.log('WP-01 database verification passed.');
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database verification failed');
    process.exitCode = 1;
  });
}
