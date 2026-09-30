import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { accountAvailable, releaseIneligibleAnnotations } from '../tasks/assignment-release';
import { OrthancService } from '../cases/orthanc.service';
import { watermarkFrame } from './frame-watermark';
import { FrameTicketService, type FrameSession, type FrameTarget } from './frame-ticket.service';
import { FrameRenderCacheService } from './frame-render-cache.service';
import { FrameRateService, type FrameModality } from './frame-rate.service';

interface Series {
  id: string; orthanc_id: string; series_uid: string; frame_count: number;
  default_window: FrameTarget['window']; modality: FrameModality; system_code: string; source: string; status: string;
}
@Injectable()
export class FramesService {
  private readonly logger = new Logger(FramesService.name);
  private ticketService?: FrameTicketService;
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource,
    private readonly rate: FrameRateService, private readonly cache: FrameRenderCacheService,
    private readonly orthanc: OrthancService) {}

  async issue(actor: AuthUser, bearer: string, body: unknown, ip: string) {
    const target = this.input(body);
    this.rate.configuration();
    const tickets = this.tickets();
    const result = await this.authorized(actor, target, async (manager, current, series) => {
      if (!await this.admit(manager, current, target, series, 'ticket', ip)) return null;
      // Bind the effective default window, so later settings cannot silently alter an issued ticket.
      const effective = { ...target, window: (body as Record<string, unknown>).window === undefined ? series.default_window : target.window };
      const ticket = tickets.issue(this.session(current, bearer), effective);
      await this.audit(manager, current, 'frames.ticket_issued', effective, series, ip);
      return ticket;
    });
    if (!result) throw new HttpException('帧请求超限，账号已停用，请联系管理员复核', 429);
    return result;
  }

  async read(actor: AuthUser, bearer: string, token: string, ip: string): Promise<Buffer> {
    this.rate.configuration();
    const target = this.tickets().verify(token, this.session(actor, bearer));
    const admitted = await this.authorized(actor, target, async (manager, current, series) => {
      return await this.admit(manager, current, target, series, 'read', ip) ? series : null;
    });
    if (!admitted) throw new HttpException('帧请求超限，账号已停用，请联系管理员复核', 429);
    const resolved = await this.orthanc.resolveSeriesFrame(admitted.orthanc_id, target.series_uid, target.frame_index, admitted.frame_count);
    const rendered = await this.cache.render({ ...target, ...resolved });
    let marked: Buffer;
    try { marked = await watermarkFrame(rendered, actor); }
    catch { throw new ServiceUnavailableException('帧水印不可用'); }
    // Rendering can take time. Recheck after I/O and audit under the same user lock used by
    // revocation/reclaim; cached pixels and already-issued tickets never grant authority.
    await this.authorized(actor, target, async (manager, current, series) => {
      if (series.id !== admitted.id || series.orthanc_id !== admitted.orthanc_id || series.frame_count !== admitted.frame_count) {
        throw new ForbiddenException('帧资源已变化');
      }
      await this.audit(manager, current, 'frames.viewed', target, series, ip);
    });
    return marked;
  }

  private async authorized<T>(actor: AuthUser, target: FrameTarget,
    work: (manager: EntityManager, current: AuthUser, series: Series) => Promise<T>): Promise<T> {
    return this.db.transaction(async manager => {
      const [current] = await manager.query(`SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [actor.id]) as AuthUser[];
      if (!current || !accountAvailable(current) || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new ForbiddenException('账号或会话已失效');
      const [series] = await manager.query(`SELECT s.id,s.orthanc_id,s.series_uid,s.frame_count,s.default_window,s.modality,c.system_code,c.source,c.status
        FROM series s JOIN studies st ON st.id=s.study_id AND st.deleted_at IS NULL
        JOIN cases c ON c.id=st.case_id AND c.deleted_at IS NULL
        WHERE s.series_uid=$1 AND st.case_id=$2 AND s.deleted_at IS NULL`, [target.series_uid, target.case_id]) as Series[];
      if (!series || !['synthetic','teacher_provided_teaching'].includes(series.source) || target.frame_index >= series.frame_count) {
        throw new ForbiddenException('帧资源不可访问');
      }
      const role = series.status === '标注中' ? 'annotate' : series.status === '审核中' ? 'review' : null;
      if (!role) throw new ForbiddenException('病例无有效工作分派');
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(current, target.case_id, series.system_code, role);
      return work(manager, current, series);
    });
  }

  private async admit(manager: EntityManager, current: AuthUser, target: FrameTarget, series: Series, phase: 'ticket' | 'read', ip: string) {
    if (await this.rate.allow(current.id, target.case_id, current.updated_at, series.modality, phase)) return true;
    // Commit lock + assignment releases + audit before returning 429. Audit failure denies output
    // and leaves the exceeded Redis counter intact, so the next attempt retries the transaction.
    await manager.query("UPDATE users SET status='disabled',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1", [current.id]);
    await releaseIneligibleAnnotations(manager, { ...current, status: 'disabled' }, current.id, ip);
    await this.audit(manager, current, 'frames.locked', target, series, ip, { phase, reason: 'rate_exceeded' });
    this.logger.warn('Frame rate exceeded; account lock requires administrator review');
    return false;
  }
  private audit(manager: EntityManager, actor: AuthUser, action: string, target: FrameTarget, series: Series, ip: string, extra = {}) {
    return manager.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4::jsonb,$5)',
      [actor.id, action, `cases:${target.case_id}`, JSON.stringify({ series_uid: target.series_uid, frame_index: target.frame_index, window: target.window, modality: series.modality, ...extra }), ip]);
  }
  private tickets() {
    try { return this.ticketService ??= new FrameTicketService(); }
    catch { throw new ServiceUnavailableException('帧票据配置尚未就绪'); }
  }
  private session(actor: AuthUser, bearer: string): FrameSession { return { user_id: actor.id, access_token: bearer }; }
  private input(body: unknown): FrameTarget {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('帧参数无效');
    const value = body as Record<string, unknown>;
    const window = value.window ?? null;
    if (Object.keys(value).some(k => !['case_id','series_uid','frame_index','window'].includes(k)) ||
        typeof value.case_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.case_id) ||
        typeof value.series_uid !== 'string' || value.series_uid.length > 64 || !/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$/.test(value.series_uid) ||
        !Number.isSafeInteger(value.frame_index) || (value.frame_index as number) < 0 ||
        (window !== null && (typeof window !== 'object' || Array.isArray(window) ||
          Object.keys(window).sort().join(',') !== 'center,width' || !Number.isFinite((window as { center: number }).center) ||
          !Number.isFinite((window as { width: number }).width) || (window as { width: number }).width <= 0))) {
      throw new BadRequestException('帧参数无效');
    }
    return { case_id: value.case_id.toLowerCase(), series_uid: value.series_uid, frame_index: value.frame_index as number, window: window as FrameTarget['window'] };
  }
}
