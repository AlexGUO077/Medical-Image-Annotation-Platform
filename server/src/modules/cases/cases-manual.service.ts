import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { RedisClientType } from 'redis';
import type { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AttachmentObjectService } from './attachment-object.service';
import { CONFIRM_METHODS, IMPORT_SOURCES, SYSTEM_CODES, type ConfirmMethod, type ImportSource, type SystemCode } from './cases-import.models';
import { MANUAL_QUARANTINE_ROOT, quarantinePath } from './cases-import.paths';
import { DeidWorkerService } from './deid-worker.service';
import { ObjectCompensationService } from './object-compensation.service';
import { watermarkPreview } from './case-preview';
import { MaskMapService } from './mask-map.service';

const MANUAL_ROOT = MANUAL_QUARANTINE_ROOT;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/i;
const TTL_SECONDS = 24 * 60 * 60;
const SOURCE_PREFIX: Record<ImportSource, string> = { synthetic: 'SYN', teacher_provided_teaching: 'TPT' };

interface ManualDraft {
  id: string;
  actor_id: string;
  source: ImportSource;
  created_at: string;
  expires_at: string;
  masked_report: string;
  masked_count: number;
  image_redaction_count: number;
}

@Injectable()
export class CasesManualService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE_SOURCE) private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly worker: DeidWorkerService,
    private readonly maskMaps: MaskMapService,
    private readonly objects: AttachmentObjectService,
    private readonly compensation: ObjectCompensationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(MANUAL_ROOT, { recursive: true, mode: 0o700 });
    await this.cleanupExpired();
    this.cleanupTimer = setInterval(() => void this.cleanupExpired().catch(() => undefined), 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async prepare(actor: AuthUser, file: Express.Multer.File | undefined, sourceValue: unknown, reportValue: unknown) {
    const uploadPath = file?.path ? quarantinePath(file.path) : undefined;
    try {
      if (typeof sourceValue !== 'string' || !IMPORT_SOURCES.includes(sourceValue as ImportSource)) {
        throw new BadRequestException('录入来源未获批准');
      }
      if (typeof reportValue !== 'string' || !reportValue.trim() || Buffer.byteLength(reportValue, 'utf8') > 2 * 1024 * 1024) {
        throw new BadRequestException('报告文本为空或超过限制');
      }
      if (!file || !uploadPath || !UPLOAD_NAME.test(file.filename) ||
          resolve(uploadPath) !== join(MANUAL_ROOT, file.filename)) {
        throw new BadRequestException('关键影像无效');
      }
      if (!['image/jpeg', 'image/png'].includes(file.mimetype) || !/\.(jpe?g|png)$/i.test(file.originalname)) {
        throw new UnsupportedMediaTypeException('仅接受 JPG/PNG 关键影像');
      }
      const declaredFormat = /\.png$/i.test(file.originalname) ? 'png' : 'jpeg';
      const metadata = await sharp(uploadPath, { limitInputPixels: 50_000_000 }).metadata();
      if (metadata.format !== declaredFormat || (metadata.pages ?? 1) !== 1 ||
          (metadata.format === 'jpeg' && file.mimetype !== 'image/jpeg') ||
          (metadata.format === 'png' && file.mimetype !== 'image/png')) {
        throw new UnsupportedMediaTypeException('关键影像内容与声明格式不符');
      }
    } catch (error) {
      if (uploadPath && file && UPLOAD_NAME.test(file.filename) &&
          resolve(uploadPath) === join(MANUAL_ROOT, file.filename)) {
        await rm(uploadPath, { force: true });
      }
      throw error;
    }

    const id = randomUUID();
    const draftPath = this.path(id);
    try {
      await mkdir(draftPath, { mode: 0o700 });
      const reportPath = join(draftPath, 'report.txt');
      const imagePath = join(draftPath, 'image.upload');
      await writeFile(reportPath, reportValue as string, { mode: 0o600 });
      await rename(uploadPath!, imagePath);
      const processedPath = join(draftPath, 'processed');
      const result = await this.worker.processManual(reportPath, imagePath, processedPath);
      if (!result || typeof result.masked_report !== 'string' || !Number.isInteger(result.masked_count) ||
          !Number.isInteger(result.image_redaction_count)) {
        throw new ConflictException('手工脱敏结果无效');
      }
      await Promise.all([rm(reportPath, { force: true }), rm(imagePath, { force: true })]);
      const now = Date.now();
      const draft: ManualDraft = {
        id,
        actor_id: actor.id,
        source: sourceValue as ImportSource,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + TTL_SECONDS * 1000).toISOString(),
        masked_report: result.masked_report,
        masked_count: result.masked_count,
        image_redaction_count: result.image_redaction_count,
      };
      const saved = await this.redis.set(this.key(id), JSON.stringify(draft), { EX: TTL_SECONDS, NX: true });
      if (saved !== 'OK') throw new ConflictException('草稿创建失败');
      return {
        draft_id: id,
        masked_report: draft.masked_report,
        masked_count: draft.masked_count,
        image_redaction_count: draft.image_redaction_count,
        expires_at: draft.expires_at,
      };
    } catch (error) {
      await rm(uploadPath!, { force: true });
      await rm(draftPath, { recursive: true, force: true });
      throw error;
    }
  }

  async preview(idValue: unknown, actor: AuthUser): Promise<Buffer> {
    const draft = await this.draft(idValue, actor);
    const image = await readFile(join(this.path(draft.id), 'processed', 'key-image.png'));
    return this.watermark(image, actor);
  }

  async confirm(idValue: unknown, actor: AuthUser, body: unknown, ip: string) {
    const id = this.uuid(idValue);
    const input = this.confirmInput(body);
    const lockKey = `miap:manual:lock:${id}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, { NX: true, EX: 600 });
    if (acquired !== 'OK') throw new ConflictException('草稿正在确认');
    try {
      const committed = await this.dataSource.query(
        `SELECT c."id", c."case_no" FROM "audit_logs" a JOIN "cases" c
           ON a."target" = 'cases:' || c."id"::text
         WHERE a."action" = 'case_manual.confirmed' AND a."actor" = $1
           AND a."detail"->>'draft_id' = $2 AND c."deleted_at" IS NULL LIMIT 1`,
        [actor.id, id],
      ) as Array<{ id: string; case_no: string }>;
      if (committed[0]) {
        return { case_id: committed[0].id, case_no: committed[0].case_no, status: '已录入' as const };
      }
      const draft = await this.draft(id, actor);
      if (!IMPORT_SOURCES.includes(draft.source)) throw new ConflictException('录入来源已失效');
      const caseId = randomUUID();
      const caseNo = `${SOURCE_PREFIX[draft.source]}-${randomUUID().slice(0, 12).toUpperCase()}`;
      const key = `cases/${caseId}/${randomUUID()}.png`;
      const processedPath = join(this.path(id), 'processed');
      const reservedMapId = randomUUID();
      const intent = await this.compensation.reserve(key, 0, reservedMapId);
      let maskMapId: string | null = null;
      try {
        const imageSize = await this.objects.storePng(key, join(processedPath, 'key-image.png'));
        maskMapId = await this.maskMaps.storeFromFile(join(processedPath, 'mask-map.json'), reservedMapId);
        const maskedReport = await readFile(join(processedPath, 'masked-report.txt'), 'utf8');
        await this.dataSource.transaction(async (manager) => {
          await manager.query(
            `INSERT INTO "cases" ("id", "case_no", "status", "source", "system_code", "confirm_method")
             VALUES ($1, $2, '已录入', $3, $4, $5)`,
            [caseId, caseNo, draft.source, input.system_code, input.confirm_method],
          );
          await manager.query(
            `INSERT INTO "reports" ("case_id", "raw_text", "sentences", "mask_map_id")
             VALUES ($1, $2, $3::jsonb, $4)`,
            [caseId, maskedReport, JSON.stringify(this.sentences(maskedReport)), maskMapId],
          );
          await manager.query(
            `INSERT INTO "attachments" ("case_id", "kind", "object_key", "filename", "size", "deid_confirmed")
             VALUES ($1, '其他', $2, 'key-image.png', $3, true)`,
            [caseId, key, String(imageSize)],
          );
          await manager.query(
            `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
             VALUES ($1, 'case_manual.confirmed', $2, $3::jsonb, $4)`,
            [actor.id, `cases:${caseId}`, JSON.stringify({
              case_id: caseId, source: draft.source, draft_id: id,
              authorization_basis: draft.source === 'synthetic' ? 'synthetic_data' : 'project_owner_confirmation',
              scope: 'development_test_only', valid_until: 'project_acceptance',
              withdrawal_action: 'stop_import_and_delete', decision: 'D-31',
              system_code: input.system_code, confirm_method: input.confirm_method,
            }), ip],
          );
        });
      } catch (error) {
        await this.compensation.compensate(intent);
        throw error;
      }
      await Promise.allSettled([
        this.compensation.complete(intent),
        this.redis.del(this.key(id)),
        rm(this.path(id), { recursive: true, force: true }),
      ]);
      return { case_id: caseId, case_no: caseNo, status: '已录入' as const };
    } finally {
      await this.redis.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
        { keys: [lockKey], arguments: [lockToken] },
      ).catch(() => undefined);
    }
  }

  async caseDetail(idValue: unknown) {
    const id = this.uuid(idValue);
    const rows = await this.dataSource.query(
      `SELECT "id", "case_no", "status", "source", "system_code", "confirm_method",
              "clinical_text", "age_band", "sex", "teaching_fields", "annotation_version"
       FROM "cases" WHERE "id" = $1 AND "deleted_at" IS NULL`, [id],
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundException('病例不存在');
    const attachments = await this.dataSource.query(
      `SELECT "id", "kind", "filename", "size", "deid_confirmed"
       FROM "attachments" WHERE "case_id" = $1 AND "deleted_at" IS NULL AND "deid_confirmed" = true
       ORDER BY "created_at", "id"`, [id],
    ) as Array<Record<string, unknown>>;
    return { ...rows[0], attachments };
  }

  async report(idValue: unknown) {
    const id = this.uuid(idValue);
    await this.caseDetail(id);
    const rows = await this.dataSource.query(
      `SELECT r."raw_text", r."sentences" FROM "reports" r
       WHERE r."case_id" = $1 AND r."deleted_at" IS NULL`, [id],
    ) as Array<{ raw_text: string; sentences: Array<{ idx: number; text: string }> }>;
    if (!rows[0]) throw new NotFoundException('病例报告不存在');
    return { masked_report: rows[0].raw_text, sentences: rows[0].sentences };
  }

  private async draft(value: unknown, actor: AuthUser): Promise<ManualDraft> {
    const id = this.uuid(value);
    const serialized = await this.redis.get(this.key(id));
    if (!serialized) throw new NotFoundException('草稿不存在或已失效');
    const draft = JSON.parse(serialized) as ManualDraft;
    if (draft.actor_id !== actor.id || draft.id !== id) throw new NotFoundException('草稿不存在或已失效');
    if (Date.parse(draft.expires_at) <= Date.now()) throw new NotFoundException('草稿不存在或已失效');
    return draft;
  }

  private confirmInput(body: unknown): { system_code: SystemCode; confirm_method: ConfirmMethod } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('确认请求无效');
    const input = body as Record<string, unknown>;
    if (input.confirmed !== true || !SYSTEM_CODES.includes(input.system_code as SystemCode) ||
        !CONFIRM_METHODS.includes(input.confirm_method as ConfirmMethod)) {
      throw new BadRequestException('脱敏确认或病例分类无效');
    }
    return { system_code: input.system_code as SystemCode, confirm_method: input.confirm_method as ConfirmMethod };
  }

  private watermark(image: Buffer, actor: AuthUser): Promise<Buffer> {
    return watermarkPreview(image, actor);
  }

  private sentences(text: string): Array<{ idx: number; text: string }> {
    return text.split(/[。；;\n]/u).map((value) => value.trim()).filter(Boolean).map((value, idx) => ({ idx, text: value }));
  }

  private uuid(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('标识必须是 UUID');
    return value;
  }

  private key(id: string): string { return `miap:manual:draft:${id}`; }
  private path(id: string): string { return quarantinePath(MANUAL_ROOT, id); }

  private async cleanupExpired(): Promise<void> {
    const entries = await readdir(MANUAL_ROOT, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!UUID.test(entry.name) && !UPLOAD_NAME.test(entry.name) && !/^text-[a-zA-Z0-9]+$/.test(entry.name)) continue;
      const target = join(MANUAL_ROOT, entry.name);
      const info = await stat(target);
      const maxAge = entry.isDirectory() ? TTL_SECONDS * 1000 - 60 * 1000 : 60 * 60 * 1000 - 60 * 1000;
      if (now - (info.birthtimeMs || info.mtimeMs) > maxAge) {
        await rm(target, { recursive: entry.isDirectory(), force: true });
      }
    }
  }
}
