import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateTaskCases1789876800010 implements MigrationInterface {
  name = 'CreateTaskCases1789876800010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_cases" (
        ${auditColumns},
        "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
        "case_id" uuid NOT NULL REFERENCES "cases"("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "task_cases_pair_active_uq" ON "task_cases" ("task_id", "case_id") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "task_cases_case_idx" ON "task_cases" ("case_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "task_cases"');
  }
}
