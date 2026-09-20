import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateReports1789876800007 implements MigrationInterface {
  name = 'CreateReports1789876800007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reports" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "raw_text" text NOT NULL,
        "sentences" jsonb NOT NULL,
        "mask_map_id" uuid
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "reports_case_active_uq" ON "reports" ("case_id") WHERE "deleted_at" IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "reports"');
  }
}
