import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { releaseIneligibleAnnotations, type ReleaseUser } from './assignment-release';
import { QualityReviewsService } from './quality-reviews';
import { TaskDispatchService } from './task-dispatch.service';

@Injectable()
export class TaskMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TaskMaintenanceService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private afterUser?: string;
  private afterCase?: string;
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource, private readonly dispatches: TaskDispatchService, private readonly quality: QualityReviewsService) {}

  onApplicationBootstrap(): void { void this.loop(); }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => undefined);
  }
  // No HTTP entry point. A single process never overlaps maintenance transactions.
  runOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.running) this.running = this.cycle().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async loop(): Promise<void> {
    try { await this.runOnce(); }
    catch { this.logger.error('Task maintenance failed; retry scheduled'); }
    finally {
      if (!this.stopped) { this.timer = setTimeout(() => { void this.loop(); }, 30_000); this.timer.unref(); }
    }
  }
  private async cycle(): Promise<void> {
    try { await this.quality.maintain(); }
    catch { this.logger.error('Quality review maintenance failed; retry scheduled'); }
    const candidates = await this.db.query(`SELECT DISTINCT u.id FROM users u
      JOIN task_assignments a ON a.assignee_id=u.id
      JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
      JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
      JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL AND c.status IN ('标注中','待审核','审核中')
      WHERE u.deleted_at IS NULL AND a.deleted_at IS NULL AND a.state='active' AND a.task_role IN ('annotate','review')
        AND c.source=t.source AND c.system_code=t.system_code AND ($1::uuid IS NULL OR u.id>$1)
        AND ((a.due_at IS NOT NULL AND a.due_at<=clock_timestamp()) OR u.status<>'active'
          OR u.expire_at<(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date OR u.must_change_password
          OR (u.role='admin' AND u.mfa_secret_encrypted IS NULL)
          OR NOT COALESCE((u.quals->t.system_code) @> jsonb_build_array(a.task_role),false)
          OR (t.review_mode='self' AND NOT COALESCE((u.quals->t.system_code) @> '["annotate","review"]'::jsonb,false)))
      ORDER BY u.id LIMIT 100`, [this.afterUser ?? null]) as { id: string }[];
    for (const candidate of candidates) {
      try {
        await this.db.transaction(async manager => {
          const [user] = await manager.query(`SELECT id,role,quals,status,expire_at::text,must_change_password,mfa_secret_encrypted
            FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE SKIP LOCKED`, [candidate.id]) as ReleaseUser[];
          if (user) await releaseIneligibleAnnotations(manager, user, null, 'system');
        });
      } catch { this.logger.error('Assignment release failed; retry scheduled'); }
    }
    this.afterUser = candidates.length === 100 ? candidates[candidates.length - 1]!.id : undefined;
    try {
      const result = await this.dispatches.maintainAutomatic(this.afterCase);
      this.afterCase = result.next_case_id ?? undefined;
    } catch (error) {
      // Mode changes can invalidate a task-scoped cursor. Restart next pass without hiding other failures.
      if (error instanceof BadRequestException) this.afterCase = undefined;
      this.logger.error('Automatic dispatch failed; retry scheduled');
    }
  }
}
