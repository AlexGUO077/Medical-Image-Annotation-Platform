import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class StudentEducation1793059200000 implements MigrationInterface {
  name = 'StudentEducation1793059200000';
  async up(q: QueryRunner): Promise<void> {
    // The original inline role CHECK has an automatically assigned PostgreSQL name.
    await q.query(`ALTER TABLE users DROP CONSTRAINT users_role_check`);
    await q.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','member','student'))`);
    await q.query(`ALTER TABLE users ADD CONSTRAINT users_student_quals_check CHECK(role<>'student' OR quals='{}'::jsonb)`);
    await q.query(`CREATE TABLE education_roster (${auditColumns},
      student_no varchar(64) NOT NULL UNIQUE, real_name varchar(100) NOT NULL, class_name varchar(100) NOT NULL DEFAULT '',
      expire_at date NOT NULL, user_id uuid UNIQUE REFERENCES users(id),
      activation_hash varchar(64), activation_expires_at timestamptz, activated_at timestamptz,
      CHECK ((activation_hash IS NULL)=(activation_expires_at IS NULL)))`);
    await q.query(`CREATE TABLE education_tasks (${auditColumns},
      title varchar(200) NOT NULL, instructions varchar(4000) NOT NULL DEFAULT '',
      status varchar NOT NULL CHECK(status IN ('published','closed','revoked')),
      created_by uuid NOT NULL REFERENCES users(id))`);
    await q.query(`CREATE TABLE education_items (${auditColumns},
      task_id uuid NOT NULL REFERENCES education_tasks(id), case_id uuid NOT NULL REFERENCES cases(id),
      ordinal int NOT NULL CHECK(ordinal>0), reference_version int NOT NULL CHECK(reference_version>=0),
      series_ids jsonb NOT NULL CHECK(jsonb_typeof(series_ids)='array'),
      reference jsonb NOT NULL CHECK(jsonb_typeof(reference)='object'), UNIQUE(task_id,ordinal), UNIQUE(task_id,case_id))`);
    await q.query(`CREATE TABLE education_students (${auditColumns},
      task_id uuid NOT NULL REFERENCES education_tasks(id), roster_id uuid NOT NULL REFERENCES education_roster(id),
      UNIQUE(task_id,roster_id))`);
    await q.query(`CREATE TABLE education_attempts (${auditColumns},
      item_id uuid NOT NULL REFERENCES education_items(id), student_id uuid NOT NULL REFERENCES users(id),
      state varchar NOT NULL DEFAULT 'in_progress' CHECK(state IN ('in_progress','submitted')),
      version int NOT NULL DEFAULT 0 CHECK(version>=0), answer jsonb NOT NULL CHECK(jsonb_typeof(answer)='object'),
      submitted_at timestamptz, UNIQUE(item_id,student_id),
      CHECK ((state='submitted')=(submitted_at IS NOT NULL)))`);
    await q.query(`CREATE INDEX education_attempts_student_idx ON education_attempts(student_id)`);
    await q.query(`CREATE FUNCTION education_submission_immutable() RETURNS trigger AS $$ BEGIN
      IF OLD.state='submitted' THEN RAISE EXCEPTION 'Submitted education answer is immutable'; END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER education_submission_immutable BEFORE UPDATE OR DELETE ON education_attempts
      FOR EACH ROW EXECUTE FUNCTION education_submission_immutable()`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(`SELECT EXISTS(SELECT 1 FROM education_roster) OR EXISTS(SELECT 1 FROM education_tasks)
      OR EXISTS(SELECT 1 FROM education_attempts) OR EXISTS(SELECT 1 FROM users WHERE role='student') AS used`);
    if (row.used) throw new Error('Student education data exists; retain schema and roll forward instead of deleting answers');
    await q.query('DROP TABLE education_attempts,education_students,education_items,education_tasks,education_roster');
    await q.query('DROP FUNCTION education_submission_immutable()');
    await q.query('ALTER TABLE users DROP CONSTRAINT users_student_quals_check, DROP CONSTRAINT users_role_check');
    await q.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','member'))`);
  }
}
