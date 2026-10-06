import type { MigrationInterface, QueryRunner } from 'typeorm';

export class QualityReviewAssignments1790942400000 implements MigrationInterface {
  name = 'QualityReviewAssignments1790942400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE task_assignments
      ADD COLUMN review_kind varchar NOT NULL DEFAULT 'normal' CHECK (review_kind IN ('normal','spotcheck','recheck')),
      ADD COLUMN review_version integer CHECK (review_version >= 0),
      ADD COLUMN started_at timestamptz,
      ALTER COLUMN assignee_id DROP NOT NULL,
      ADD CONSTRAINT quality_assignment_shape CHECK (
        (review_kind='normal' AND assignee_id IS NOT NULL AND review_version IS NULL AND started_at IS NULL AND state<>'pending') OR
        (review_kind<>'normal' AND task_role='review' AND review_version IS NOT NULL AND
          ((state='pending' AND assignee_id IS NULL AND started_at IS NULL) OR
           (state IN ('active','completed','released') AND assignee_id IS NOT NULL) OR
           (state='cancelled' AND started_at IS NULL))))`);
    await q.query(`CREATE UNIQUE INDEX quality_assignment_unfinished_uq ON task_assignments(case_id,review_version)
      WHERE deleted_at IS NULL AND review_kind<>'normal' AND state IN ('active','pending')`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM task_assignments WHERE review_kind<>'normal') THEN
      RAISE EXCEPTION 'Preserve quality review history before rollback'; END IF; END $$`);
    await q.query('DROP INDEX quality_assignment_unfinished_uq');
    await q.query(`ALTER TABLE task_assignments DROP CONSTRAINT quality_assignment_shape,
      ALTER COLUMN assignee_id SET NOT NULL, DROP COLUMN review_kind, DROP COLUMN review_version, DROP COLUMN started_at`);
  }
}
