import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditColumns } from '../migration-columns';

export class CreateTasks1789876800009 implements MigrationInterface {
  name = 'CreateTasks1789876800009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        ${auditColumns},
        "name" varchar NOT NULL,
        "source" varchar NOT NULL,
        "system_code" varchar NOT NULL CHECK ("system_code" IN ('cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone')),
        "review_mode" varchar NOT NULL CHECK ("review_mode" IN ('self', 'peer')),
        "priority" int NOT NULL,
        "status" varchar NOT NULL CHECK ("status" IN ('进行中', '已完成', '已归档'))
      )
    `);
    await queryRunner.query('CREATE INDEX "tasks_scope_status_idx" ON "tasks" ("source", "system_code", "status")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "tasks"');
  }
}
