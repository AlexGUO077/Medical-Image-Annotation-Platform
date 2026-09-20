import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateAnnotationObjects1789876800012 implements MigrationInterface {
  name = 'CreateAnnotationObjects1789876800012';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "annotation_objects" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "series_id" uuid NOT NULL REFERENCES "series"("id"),
        "tool" varchar NOT NULL CHECK ("tool" IN ('box', 'brush', 'polygon', 'point')),
        "geometry" jsonb NOT NULL,
        "frame_start" int NOT NULL CHECK ("frame_start" >= 0),
        "frame_end" int NOT NULL CHECK ("frame_end" >= "frame_start"),
        "window_preset" varchar,
        "report_sent_ids" jsonb NOT NULL,
        "part_id" uuid NOT NULL,
        "confidence" varchar NOT NULL CHECK ("confidence" IN ('典型', '不典型')),
        "measurements" jsonb,
        "version" int NOT NULL CHECK ("version" > 0),
        "is_gold" bool NOT NULL DEFAULT false,
        "created_by" uuid NOT NULL REFERENCES "users"("id"),
        "task_id" uuid NOT NULL REFERENCES "tasks"("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "annotation_objects_case_version_idx" ON "annotation_objects" ("case_id", "version")');
    await queryRunner.query('CREATE INDEX "annotation_objects_series_idx" ON "annotation_objects" ("series_id")');
    await queryRunner.query('CREATE INDEX "annotation_objects_report_sent_ids_gin" ON "annotation_objects" USING gin ("report_sent_ids")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "annotation_objects"');
  }
}
