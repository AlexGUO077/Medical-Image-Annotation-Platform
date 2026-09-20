import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateReviews1789876800014 implements MigrationInterface {
  name = 'CreateReviews1789876800014';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reviews" (
        ${auditColumns},
        "case_id" uuid NOT NULL REFERENCES "cases"("id"),
        "reviewer_id" uuid NOT NULL REFERENCES "users"("id"),
        "result" varchar NOT NULL CHECK ("result" IN ('通过', '打回')),
        "comments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "is_spotcheck" bool NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query('CREATE INDEX "reviews_case_idx" ON "reviews" ("case_id")');
    await queryRunner.query('CREATE INDEX "reviews_reviewer_idx" ON "reviews" ("reviewer_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "reviews"');
  }
}
