import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateStudies1789876800005 implements MigrationInterface {
  name = 'CreateStudies1789876800005';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "studies" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "study_uid" varchar NOT NULL,
        "study_date" date NOT NULL
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "studies_uid_active_uq" ON "studies" ("study_uid") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "studies_case_idx" ON "studies" ("case_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "studies"');
  }
}
