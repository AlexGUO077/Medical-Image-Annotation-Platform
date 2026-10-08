import type {MigrationInterface,QueryRunner} from 'typeorm';
export class ControlledExports1791331200000 implements MigrationInterface {
 name='ControlledExports1791331200000';
 async up(q:QueryRunner){
  await q.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM export_requests) THEN RAISE EXCEPTION 'Review existing export ownership before migration'; END IF; END $$`);
  await q.query(`ALTER TABLE export_requests ADD COLUMN requester_id uuid NOT NULL REFERENCES users(id),
   ADD COLUMN case_versions jsonb NOT NULL CHECK(jsonb_typeof(case_versions)='array' AND jsonb_array_length(case_versions) BETWEEN 1 AND 20),
   ADD COLUMN download_count integer NOT NULL DEFAULT 0 CHECK(download_count IN (0,1)), ADD COLUMN package_sha256 varchar,
   ADD CONSTRAINT export_separation CHECK(approver_id IS NULL OR approver_id<>requester_id),
   ADD CONSTRAINT export_state_shape CHECK((status='待审批' AND approver_id IS NULL AND url IS NULL AND expire_at IS NULL AND package_sha256 IS NULL AND download_count=0)
    OR (status='已拒绝' AND approver_id IS NOT NULL AND url IS NULL AND expire_at IS NULL AND package_sha256 IS NULL AND download_count=0)
    OR (status='已批准' AND approver_id IS NOT NULL AND url IS NOT NULL AND expire_at IS NOT NULL AND package_sha256 IS NOT NULL AND package_sha256 ~ '^[0-9a-f]{64}$'))`);
 }
 async down(q:QueryRunner){
  await q.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM export_requests) THEN RAISE EXCEPTION 'Preserve export history before rollback'; END IF; END $$`);
  await q.query(`ALTER TABLE export_requests DROP CONSTRAINT export_state_shape,DROP CONSTRAINT export_separation,DROP COLUMN package_sha256,DROP COLUMN download_count,DROP COLUMN case_versions,DROP COLUMN requester_id`);
 }
}
