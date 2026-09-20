import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateExportRequests1789876800016 implements MigrationInterface {
  name = 'CreateExportRequests1789876800016';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "export_requests" (
        ${auditColumns},
        "status" varchar NOT NULL CHECK ("status" IN ('待审批', '已批准', '已拒绝')),
        "approver_id" uuid REFERENCES "users"("id"),
        "expire_at" timestamptz,
        "url" varchar
      )
    `);
    await queryRunner.query('CREATE INDEX "export_requests_status_idx" ON "export_requests" ("status")');
    await queryRunner.query('CREATE INDEX "export_requests_approver_idx" ON "export_requests" ("approver_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "export_requests"');
  }
}
