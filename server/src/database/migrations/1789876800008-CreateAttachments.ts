import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateAttachments1789876800008 implements MigrationInterface {
  name = 'CreateAttachments1789876800008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "attachments" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "kind" varchar NOT NULL CHECK ("kind" IN ('检查报告', '病理', '其他')),
        "object_key" varchar NOT NULL,
        "filename" varchar NOT NULL,
        "size" varchar NOT NULL,
        "deid_confirmed" bool NOT NULL
      )
    `);
    await queryRunner.query('CREATE INDEX "attachments_case_idx" ON "attachments" ("case_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "attachments"');
  }
}
