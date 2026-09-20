import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateTaskAssignments1789876800011 implements MigrationInterface {
  name = 'CreateTaskAssignments1789876800011';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_assignments" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "assignee_id" uuid NOT NULL REFERENCES "users"("id"),
        "task_role" varchar NOT NULL CHECK ("task_role" IN ('annotate', 'review')),
        "due_at" timestamptz NOT NULL,
        "state" varchar NOT NULL
      )
    `);
    await queryRunner.query('CREATE INDEX "task_assignments_assignee_state_idx" ON "task_assignments" ("assignee_id", "state")');
    await queryRunner.query('CREATE INDEX "task_assignments_case_role_idx" ON "task_assignments" ("case_id", "task_role")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "task_assignments"');
  }
}
