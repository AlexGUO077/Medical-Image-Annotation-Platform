import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateAuditLogs1789876800015 implements MigrationInterface {
  name = 'CreateAuditLogs1789876800015';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        ${auditColumns},
        "actor" uuid NOT NULL REFERENCES "users"("id"),
        "action" varchar NOT NULL,
        "target" varchar NOT NULL,
        "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "ip" varchar NOT NULL
      )
    `);
    await queryRunner.query('CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" ("actor", "created_at")');
    await queryRunner.query('CREATE INDEX "audit_logs_target_created_idx" ON "audit_logs" ("target", "created_at")');
    await queryRunner.query(`
      CREATE FUNCTION "reject_audit_log_changes"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "reject_audit_log_changes"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "audit_logs"');
    await queryRunner.query('DROP FUNCTION "reject_audit_log_changes"()');
  }
}
