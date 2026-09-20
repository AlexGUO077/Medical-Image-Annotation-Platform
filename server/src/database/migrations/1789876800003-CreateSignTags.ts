import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateSignTags1789876800003 implements MigrationInterface {
  name = 'CreateSignTags1789876800003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sign_tags" (
        ${auditColumns},
        "name" varchar NOT NULL,
        "system_code" varchar NOT NULL CHECK ("system_code" IN ('cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone')),
        "definition" text NOT NULL
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "sign_tags_system_name_active_uq" ON "sign_tags" ("system_code", "name") WHERE "deleted_at" IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "sign_tags"');
  }
}
