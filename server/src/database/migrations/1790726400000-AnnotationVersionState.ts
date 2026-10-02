import type { MigrationInterface, QueryRunner } from 'typeorm';

/** D-05: preserve versions in the existing object/tag tables, including empty saves. */
export class AnnotationVersionState1790726400000 implements MigrationInterface {
  name = 'AnnotationVersionState1790726400000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE cases ADD COLUMN annotation_version int NOT NULL DEFAULT 0 CHECK (annotation_version >= 0)');
    await queryRunner.query(`UPDATE cases c SET annotation_version=v.version FROM
      (SELECT case_id,max(version) AS version FROM annotation_objects GROUP BY case_id) v WHERE c.id=v.case_id`);
    await queryRunner.query('ALTER TABLE annotation_objects ADD COLUMN logical_id uuid');
    // Existing rows retain their identity; no historical lineage is guessed.
    await queryRunner.query('UPDATE annotation_objects SET logical_id=id');
    await queryRunner.query('ALTER TABLE annotation_objects ALTER COLUMN logical_id SET NOT NULL');
    await queryRunner.query('ALTER TABLE annotation_objects ADD COLUMN key_frame_index int');
    await queryRunner.query('UPDATE annotation_objects SET key_frame_index=frame_start');
    await queryRunner.query('ALTER TABLE annotation_objects ALTER COLUMN key_frame_index SET NOT NULL');
    await queryRunner.query('ALTER TABLE annotation_objects ADD CONSTRAINT annotation_key_frame_range CHECK (key_frame_index BETWEEN frame_start AND frame_end)');
    await queryRunner.query('ALTER TABLE annotation_objects ADD CONSTRAINT annotation_part_fk FOREIGN KEY (part_id) REFERENCES taxonomy_nodes(id)');
    await queryRunner.query('CREATE UNIQUE INDEX annotation_objects_logical_version_uq ON annotation_objects(case_id,logical_id,version)');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // Do not silently discard cross-version identities or empty-version state after use.
    await queryRunner.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM audit_logs WHERE action='annotations.saved') THEN RAISE EXCEPTION 'Annotation history exists: restore a compatible backup instead of dropping version metadata'; END IF; END $$");
    await queryRunner.query('ALTER TABLE annotation_objects DROP CONSTRAINT annotation_part_fk');
    await queryRunner.query('ALTER TABLE annotation_objects DROP COLUMN key_frame_index');
    await queryRunner.query('DROP INDEX annotation_objects_logical_version_uq');
    await queryRunner.query('ALTER TABLE annotation_objects DROP COLUMN logical_id');
    await queryRunner.query('ALTER TABLE cases DROP COLUMN annotation_version');
  }
}
