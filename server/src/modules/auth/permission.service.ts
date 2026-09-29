import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
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
    // Check live account, assignment and resource state in one statement, including self-review qualification.
    const assignments = await this.dataSource.query(
      `SELECT a.id FROM task_assignments a
       JOIN users u ON u.id=a.assignee_id AND u.deleted_at IS NULL
       JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
       JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
       JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL
       WHERE a.case_id=$1 AND a.assignee_id=$2 AND a.task_role=$3 AND a.deleted_at IS NULL
         AND a.state='active' AND (a.due_at IS NULL OR a.due_at>clock_timestamp())
         AND t.system_code=$4 AND c.system_code=t.system_code AND c.source=t.source
         AND c.status=$5 AND u.status='active' AND u.expire_at>=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         AND NOT u.must_change_password AND (u.role<>'admin' OR u.mfa_secret_encrypted IS NOT NULL)
         AND date_trunc('milliseconds',u.updated_at)=$6 AND (u.quals->$4) @> jsonb_build_array($3::text)
         AND ($3<>'annotate' OR t.review_mode<>'self' OR (u.quals->$4) @> '["review"]'::jsonb)
       LIMIT 1`,
      [caseId, user.id, taskRole, systemCode, taskRole === 'annotate' ? '标注中' : '审核中', user.updated_at],
    ) as Array<{ id: string }>;
    if (!assignments[0]) throw new ForbiddenException('病例未有效分派给当前账号');
  }
}
