import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateAnnotationTags1789876800013 implements MigrationInterface {
  name = 'CreateAnnotationTags1789876800013';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "annotation_tags" (
        ${auditColumns},
        "annotation_id" uuid NOT NULL REFERENCES "annotation_objects"("id"),
        "sign_tag_id" uuid NOT NULL REFERENCES "sign_tags"("id")
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "annotation_tags_pair_active_uq" ON "annotation_tags" ("annotation_id", "sign_tag_id") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "annotation_tags_sign_idx" ON "annotation_tags" ("sign_tag_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "annotation_tags"');
  }
}
