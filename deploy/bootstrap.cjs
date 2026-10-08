// One-shot local synthetic provisioning. Administrator credentials never enter
// the long-running server container; manage.py passes them only to this process.
'use strict';
const { AppDataSource: database } = require('./dist/database/data-source');
const { provisionApplicationRole } = require('./dist/database/provision-role');
const { seedDatabase } = require('./dist/database/seed');

async function main() {
  if (process.env.POSTGRES_HOST !== 'postgres' || process.env.POSTGRES_DB !== 'miap_synthetic'
      || process.env.POSTGRES_USER !== 'miap_owner') throw Error('Unexpected deployment target');
  await database.initialize();
  try {
    const [existing] = await database.query("SELECT to_regclass('public.cases') AS table_name");
    if (existing.table_name) {
      const [{ count }] = await database.query("SELECT count(*) FROM cases WHERE source IS DISTINCT FROM 'synthetic'");
      if (Number(count) !== 0) throw Error('Non-synthetic data');
    }
    await database.runMigrations({ transaction: 'all' });
    const [{ count }] = await database.query("SELECT count(*) FROM cases WHERE source IS DISTINCT FROM 'synthetic'");
    if (Number(count) !== 0) throw Error('Non-synthetic data');
    await provisionApplicationRole(database);
    await database.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miap_runtime') THEN
        CREATE ROLE miap_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END $$`);
    const [{ password }] = await database.query('SELECT quote_literal($1) AS password', [process.env.POSTGRES_APP_PASSWORD]);
    await database.query(`ALTER ROLE miap_runtime PASSWORD ${password}`);
    await database.query('GRANT miap_app TO miap_runtime');
    await seedDatabase(database, process.env.SEED_ADMIN_PASSWORD);
  } finally {
    await database.destroy();
  }
  const headers = {
    Authorization: `Basic ${Buffer.from(`elastic:${process.env.ELASTIC_PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  for (const [path, body] of [
    ['role/miap_published', { cluster: [], indices: [{ names: ['miap-published-*'], privileges: ['create_index', 'view_index_metadata', 'read', 'write'] }] }],
    ['user/miap_search', { password: process.env.SEARCH_ELASTIC_PASSWORD, roles: ['miap_published'] }],
  ]) {
    const response = await fetch(`http://elasticsearch:9200/_security/${path}`, {
      method: 'PUT', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error('Search account provisioning failed');
  }
  console.log('Synthetic database and search accounts provisioned.');
}
void main().catch(() => { console.error('Synthetic bootstrap failed; private configuration or stored data requires inspection.'); process.exitCode = 1; });
