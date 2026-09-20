import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateCases1789876800004 implements MigrationInterface {
  name = 'CreateCases1789876800004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cases" (
        ${auditColumns},
        "case_no" varchar NOT NULL,
        "status" varchar NOT NULL CHECK ("status" IN ('已录入', '待分配', '标注中', '待审核', '审核中', '已发布', '已下线')),
        "source" varchar NOT NULL,
        "system_code" varchar NOT NULL CHECK ("system_code" IN ('cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone')),
        "disease_tag_id" uuid REFERENCES "taxonomy_nodes"("id"),
        "clinical_text" text,
        "age_band" varchar,
        "sex" varchar,
        "confirm_method" varchar NOT NULL CHECK ("confirm_method" IN ('病理证实', '随访确诊', '临床综合诊断')),
        "teaching_fields" jsonb
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "cases_case_no_active_uq" ON "cases" ("case_no") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "cases_system_status_idx" ON "cases" ("system_code", "status")');
    await queryRunner.query('CREATE INDEX "cases_disease_tag_idx" ON "cases" ("disease_tag_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "cases"');
  }
}
