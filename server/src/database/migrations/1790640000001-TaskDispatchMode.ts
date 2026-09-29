import type { MigrationInterface, QueryRunner } from 'typeorm';
export class TaskDispatchMode1790640000001 implements MigrationInterface {
  name = 'TaskDispatchMode1790640000001';
  async up(q: QueryRunner): Promise<void> {
    // Preserve existing manual workflows; only new tasks default to auto.
    await q.query("ALTER TABLE tasks ADD COLUMN dispatch_mode varchar NOT NULL DEFAULT 'manual' CHECK (dispatch_mode IN ('auto','manual','pool'))");
    await q.query("ALTER TABLE tasks ALTER COLUMN dispatch_mode SET DEFAULT 'auto'");
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM tasks WHERE dispatch_mode <> 'manual')
      THEN RAISE EXCEPTION 'Set tasks to manual before reverting dispatch mode'; END IF; END $$`);
    await q.query('ALTER TABLE tasks DROP COLUMN dispatch_mode');
  }
}
