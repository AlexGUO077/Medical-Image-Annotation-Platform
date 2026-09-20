import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAuthState1789876800017 implements MigrationInterface {
  name = 'AddUserAuthState1789876800017';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT true,
      ADD COLUMN "mfa_secret_encrypted" varchar
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "mfa_secret_encrypted",
      DROP COLUMN "must_change_password"
    `);
  }
}
