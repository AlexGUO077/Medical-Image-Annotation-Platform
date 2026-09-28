import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IsolateActiveTaskCases1790553600000 implements MigrationInterface {
  name = 'IsolateActiveTaskCases1790553600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE UNIQUE INDEX "task_cases_case_active_uq" ON "task_cases" ("case_id") WHERE "deleted_at" IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "task_cases_case_active_uq"');
  }
}
