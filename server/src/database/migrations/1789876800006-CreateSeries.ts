import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateSeries1789876800006 implements MigrationInterface {
  name = 'CreateSeries1789876800006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "series" (
        ${auditColumns},
        "study_id" uuid NOT NULL REFERENCES "studies"("id"),
        "modality" varchar NOT NULL CHECK ("modality" IN ('CR', 'DX', 'CT', 'MR', 'US')),
        "series_uid" varchar NOT NULL,
        "orthanc_id" varchar NOT NULL,
        "frame_count" int NOT NULL CHECK ("frame_count" > 0),
        "default_window" jsonb,
        CONSTRAINT "series_ct_window_ck" CHECK ("modality" <> 'CT' OR "default_window" IS NOT NULL)
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "series_uid_active_uq" ON "series" ("series_uid") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE UNIQUE INDEX "series_orthanc_active_uq" ON "series" ("orthanc_id") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "series_study_idx" ON "series" ("study_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "series"');
  }
}
