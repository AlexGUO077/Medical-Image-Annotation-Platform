import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateUsers1789876800001 implements MigrationInterface {
  name = 'CreateUsers1789876800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        ${auditColumns},
        "username" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "real_name" varchar NOT NULL,
        "email" varchar,
        "phone" varchar,
        "role" varchar NOT NULL CHECK ("role" IN ('admin', 'member')),
        "quals" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar NOT NULL CHECK ("status" IN ('active', 'disabled')),
        "expire_at" date NOT NULL
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "users_username_active_uq" ON "users" ("username") WHERE "deleted_at" IS NULL');
    await queryRunner.query('CREATE INDEX "users_quals_gin" ON "users" USING gin ("quals")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "users"');
  }
}
