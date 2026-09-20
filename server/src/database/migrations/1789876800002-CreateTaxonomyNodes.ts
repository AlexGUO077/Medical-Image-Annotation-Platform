import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateTaxonomyNodes1789876800002 implements MigrationInterface {
  name = 'CreateTaxonomyNodes1789876800002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "taxonomy_nodes" (
        ${auditColumns},
        "parent_id" uuid REFERENCES "taxonomy_nodes"("id"),
        "level" int NOT NULL CHECK ("level" BETWEEN 1 AND 4),
        "name" varchar NOT NULL,
        "synonyms" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "icd" varchar
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "taxonomy_nodes_level_name_active_uq" ON "taxonomy_nodes" ("level", "name") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "taxonomy_nodes_parent_idx" ON "taxonomy_nodes" ("parent_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "taxonomy_nodes"');
  }
}
