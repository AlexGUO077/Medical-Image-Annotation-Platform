import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TaskAssignmentCapacity1790640000000 implements MigrationInterface {
  name = 'TaskAssignmentCapacity1790640000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tasks ADD COLUMN in_flight_limit integer CHECK (in_flight_limit > 0)');
    await queryRunner.query('ALTER TABLE users ADD COLUMN in_flight_limit integer CHECK (in_flight_limit > 0)');
    await queryRunner.query(`CREATE UNIQUE INDEX task_assignments_active_role_uq ON task_assignments (case_id, task_role)
      WHERE deleted_at IS NULL AND state = 'active'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Do not silently discard configured business limits during a rollback.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM tasks WHERE in_flight_limit IS NOT NULL)
         OR EXISTS (SELECT 1 FROM users WHERE in_flight_limit IS NOT NULL) THEN
        RAISE EXCEPTION 'Clear configured capacity limits explicitly before rollback';
      END IF;
    END $$`);
    await queryRunner.query('DROP INDEX task_assignments_active_role_uq');
    await queryRunner.query('ALTER TABLE users DROP COLUMN in_flight_limit');
    await queryRunner.query('ALTER TABLE tasks DROP COLUMN in_flight_limit');
  }
}
