import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowUnsetAssignmentDeadline1790553600001 implements MigrationInterface {
  name = 'AllowUnsetAssignmentDeadline1790553600001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "task_assignments" ALTER COLUMN "due_at" DROP NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Fail if unset deadlines exist: never invent a deadline or delete assignments to roll back.
    await queryRunner.query('ALTER TABLE "task_assignments" ALTER COLUMN "due_at" SET NOT NULL');
  }
}
