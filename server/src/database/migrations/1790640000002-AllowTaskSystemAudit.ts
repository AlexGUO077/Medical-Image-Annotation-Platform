import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AllowTaskSystemAudit1790640000002 implements MigrationInterface {
  name = 'AllowTaskSystemAudit1790640000002';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE audit_logs ALTER COLUMN actor DROP NOT NULL');
    await q.query(`ALTER TABLE audit_logs ADD CONSTRAINT task_system_audit_actor CHECK (
      actor IS NOT NULL OR (action IN ('tasks.assignment_released','tasks.auto_dispatched')
        AND detail @> '{"executor":"task-worker"}'::jsonb AND ip='system'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    // Audit rows are append-only: never delete events or attribute them to a fabricated user.
    await q.query('ALTER TABLE audit_logs ALTER COLUMN actor SET NOT NULL');
    await q.query('ALTER TABLE audit_logs DROP CONSTRAINT task_system_audit_actor');
  }
}
