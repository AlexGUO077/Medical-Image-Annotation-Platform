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
      `SELECT "id" FROM "task_assignments"
       WHERE "case_id" = $1 AND "assignee_id" = $2 AND "task_role" = $3 AND "deleted_at" IS NULL
       LIMIT 1`,
      [caseId, user.id, taskRole],
    ) as Array<{ id: string }>;
    if (!assignments[0]) throw new ForbiddenException('病例未分派给当前账号');
    const cases = await this.dataSource.query(
      `SELECT "id" FROM "cases"
       WHERE "id" = $1 AND "system_code" = $2 AND "deleted_at" IS NULL`,
      [caseId, systemCode],
    ) as Array<{ id: string }>;
    if (!cases[0]) throw new NotFoundException('病例不存在');
  }
}
