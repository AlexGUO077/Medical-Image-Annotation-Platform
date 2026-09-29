import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import type { AuthUser, Qualification } from './auth.models';

@Injectable()
export class PermissionService {
  constructor(@Inject(DATABASE_SOURCE) private readonly dataSource: DataSource) {}

  assertQualification(user: AuthUser, systemCode: string, required: Qualification): void {
    if (!user.quals[systemCode]?.includes(required)) throw new ForbiddenException('缺少对应系统资格');
  }

  async assertCaseAssignment(
    user: AuthUser,
    caseId: string,
    systemCode: string,
    taskRole: 'annotate' | 'review',
  ): Promise<void> {
    this.assertQualification(user, systemCode, taskRole);
    const assignments = await this.dataSource.query(
      `SELECT a."id" FROM "task_assignments" a
       JOIN "task_cases" tc ON tc."case_id"=a."case_id" AND tc."deleted_at" IS NULL
       JOIN "tasks" t ON t."id"=tc."task_id" AND t."deleted_at" IS NULL AND t."status"='进行中'
       WHERE a."case_id" = $1 AND a."assignee_id" = $2 AND a."task_role" = $3 AND a."deleted_at" IS NULL
         AND a."state"='active' AND (a."due_at" IS NULL OR a."due_at">clock_timestamp())
         AND t."system_code"=$4
       LIMIT 1`,
      [caseId, user.id, taskRole, systemCode],
    ) as Array<{ id: string }>;
    if (!assignments[0]) throw new ForbiddenException('病例未分派给当前账号');
    const cases = await this.dataSource.query(
      `SELECT "id" FROM "cases"
       WHERE "id" = $1 AND "system_code" = $2 AND "deleted_at" IS NULL
         AND "status" = $3
         AND EXISTS (SELECT 1 FROM task_cases tc JOIN tasks t ON t.id=tc.task_id
           WHERE tc.case_id=cases.id AND tc.deleted_at IS NULL AND t.deleted_at IS NULL
             AND t.source=cases.source AND t.system_code=cases.system_code)`,
      [caseId, systemCode, taskRole === 'annotate' ? '标注中' : '审核中'],
    ) as Array<{ id: string }>;
    if (!cases[0]) throw new NotFoundException('病例不存在');
  }
}
