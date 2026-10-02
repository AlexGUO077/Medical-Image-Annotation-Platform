import type { MigrationInterface,QueryRunner } from 'typeorm';
export class AnnotationDraftAttributes1790769600000 implements MigrationInterface {
 name='AnnotationDraftAttributes1790769600000';
 async up(q:QueryRunner):Promise<void>{await q.query('ALTER TABLE annotation_objects ALTER COLUMN part_id DROP NOT NULL, ALTER COLUMN confidence DROP NOT NULL');}
 async down(q:QueryRunner):Promise<void>{
  // PostgreSQL refuses rollback if incomplete draft/history rows exist; never discard drafts.
  await q.query('ALTER TABLE annotation_objects ALTER COLUMN part_id SET NOT NULL, ALTER COLUMN confidence SET NOT NULL');
 }
}
