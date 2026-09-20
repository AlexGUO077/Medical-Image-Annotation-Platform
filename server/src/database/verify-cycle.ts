import { AppDataSource } from './data-source';
import { provisionApplicationRole } from './provision-role';
import { seedDatabase } from './seed';
import { existingBusinessTables, verifyDatabase } from './verify';

async function main(): Promise<void> {
  if (process.env.WP01_VERIFY_EMPTY_DATABASE !== '1') {
    throw new Error('Set WP01_VERIFY_EMPTY_DATABASE=1 only for an empty disposable database');
  }
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required');

  await AppDataSource.initialize();
  try {
    const before = await existingBusinessTables(AppDataSource);
    if (before.length > 0) throw new Error(`Verification database is not empty: ${before.join(', ')}`);

    await AppDataSource.runMigrations({ transaction: 'each' });
    await provisionApplicationRole(AppDataSource);
    await seedDatabase(AppDataSource, password);
    await verifyDatabase(AppDataSource);

    for (;;) {
      const rows = await AppDataSource.query(
        'SELECT count(*)::int AS count FROM "typeorm_migrations"',
      ) as Array<{ count: number }>;
      const count = rows[0]?.count;
      if (count === undefined) throw new Error('Migration count query returned no result');
      if (count === 0) break;
      await AppDataSource.undoLastMigration({ transaction: 'each' });
    }
    const afterRollback = await existingBusinessTables(AppDataSource);
    if (afterRollback.length > 0) throw new Error(`Rollback left business tables: ${afterRollback.join(', ')}`);

    await AppDataSource.runMigrations({ transaction: 'each' });
    await provisionApplicationRole(AppDataSource);
    await seedDatabase(AppDataSource, password);
    await verifyDatabase(AppDataSource);
    console.log('WP-01 migration, seed, full rollback, rebuild, and minimum-role verification passed.');
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'WP-01 verification cycle failed');
  process.exitCode = 1;
});
