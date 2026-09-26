import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RedisClientType } from 'redis';
import type { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AttachmentObjectService } from './attachment-object.service';
import { CASE_UUID, caseUuid, editableCase } from './cases-clinical.service';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { DeidWorkerService } from './deid-worker.service';
import { ObjectCompensationService } from './object-compensation.service';
import { watermarkPreview } from './case-preview';

const ROOT = join(IMPORT_QUARANTINE_ROOT, 'attachments');
const TTL = 24 * 60 * 60;
const CHUNK = 5 * 1024 * 1024;
const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
interface UploadState {
  id: string; case_id: string; actor_id: string; format: string; file_size: number; part_count: number;
  next_part_index: number; received: number; expires_at: number;
  status: 'receiving' | 'processing' | 'pending_confirmation' | 'failed';
  page_count: number; failure_code: string | null;
}

@Injectable()
export class CasesAttachmentsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly worker: DeidWorkerService, private readonly objects: AttachmentObjectService, private readonly compensation: ObjectCompensationService) {}

  async onModuleInit() {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    await this.cleanup();
    this.timer = setInterval(() => void this.cleanup().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async receive(caseValue: unknown, actor: AuthUser, body: Record<string, unknown>, file?: Express.Multer.File) {
    const caseId = caseUuid(caseValue);
    const integer = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
    const part = integer(body.part_index), count = integer(body.part_count), size = integer(body.file_size);
    const format = typeof body.format === 'string' ? body.format : '';
    if (!file?.buffer || !file.buffer.length || file.buffer.length > CHUNK || !Object.hasOwn(MIME, format) ||
        file.mimetype !== MIME[format] || file.originalname !== `chunk.${format}` ||
        !Number.isSafeInteger(size) || size < 1 || size > 50 * 1024 * 1024 ||
        !Number.isSafeInteger(count) || count < 1 || count > 100 || count < Math.ceil(size / CHUNK) ||
        !Number.isSafeInteger(part) || part < 0 || part >= count || (!body.upload_id && part !== 0)) {
      throw new BadRequestException('附件分片格式、大小或顺序无效');
    }
    await editableCase(this.db, caseId);
    const id = body.upload_id ? caseUuid(body.upload_id) : randomUUID();
    return this.lock(id, async () => {
      const state: UploadState = body.upload_id ? await this.state(caseId, id, actor) : {
        id, case_id: caseId, actor_id: actor.id, format, file_size: size, part_count: count,
        next_part_index: 0, received: 0, expires_at: Date.now() + TTL * 1000,
        status: 'receiving', page_count: 0, failure_code: null,
      };
      const final = part === count - 1;
      const received = state.received + file.buffer.length;
      if (state.status !== 'receiving' || state.next_part_index !== part || state.format !== format ||
          state.file_size !== size || state.part_count !== count || received > size ||
          (final ? received !== size : received >= size || size - received > (count - part - 1) * CHUNK)) {
        throw new ConflictException('分片重复、缺失或与上传会话不一致');
      }
      const dir = join(ROOT, id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      try {
        await writeFile(join(dir, `part-${part}`), file.buffer, { flag: 'wx', mode: 0o600 });
        state.received = received;
        state.next_part_index++;
        state.status = final ? 'processing' : 'receiving';
        await this.save(state);
      } catch (error) {
        // Incomplete persistence cannot leave an apparently resumable session.
        await rm(dir, { recursive: true, force: true });
        await this.redis.del(this.key(id));
        throw error;
      }
      if (final) void this.process(state).catch(() => undefined);
      return { upload_id: id, status: state.status, next_part_index: state.next_part_index, part_count: count };
    });
  }

  async progress(caseValue: unknown, idValue: unknown, actor: AuthUser) {
    const state = await this.state(caseUuid(caseValue), caseUuid(idValue), actor);
    return { status: state.status, next_part_index: state.next_part_index, part_count: state.part_count,
      page_count: state.page_count, failure_code: state.failure_code };
  }

  async uploadPreview(caseValue: unknown, idValue: unknown, pageValue: unknown, actor: AuthUser) {
    const state = await this.state(caseUuid(caseValue), caseUuid(idValue), actor);
    if (state.status !== 'pending_confirmation') throw new NotFoundException('安全预览不存在');
    const page = this.page(pageValue, state.page_count);
    return watermarkPreview(await readFile(join(ROOT, state.id, 'processed', `page-${page}.png`)), actor);
  }

  async confirm(caseValue: unknown, idValue: unknown, actor: AuthUser, body: Record<string, unknown>, ip: string) {
    const caseId = caseUuid(caseValue), id = caseUuid(idValue);
    if (body?.confirmed !== true || !['检查报告', '病理', '其他'].includes(body.kind as string)) throw new BadRequestException('请显式确认附件类型和脱敏结果');
    return this.lock(id, async () => {
      await editableCase(this.db, caseId);
      const prior = await this.db.query(`SELECT a."id", a."filename", a."size", a."deid_confirmed" FROM "attachments" a JOIN "audit_logs" l ON l."target" = 'attachments:' || a."id"::text WHERE a."case_id" = $1 AND l."actor" = $2 AND l."action" = 'attachment.confirmed' AND l."detail"->>'upload_id' = $3 AND a."deleted_at" IS NULL`, [caseId, actor.id, id]) as Array<{ id: string; filename: string; size: string; deid_confirmed: boolean }>;
      if (prior[0]) return { attachment_id: prior[0].id, filename: prior[0].filename, size: prior[0].size, deid_confirmed: true };
      const state = await this.state(caseId, id, actor);
      if (state.status !== 'pending_confirmation') throw new ConflictException('附件尚未通过安全处理');
      const attachmentId = randomUUID(), key = `cases/${caseId}/${attachmentId}`;
      const filename = `attachment-${attachmentId.slice(0, 8)}.preview`;
      const intent = await this.compensation.reserve(key, state.page_count);
      let size = 0;
      try {
        size = await this.objects.storePages(key, join(ROOT, id, 'processed'), state.page_count);
        await this.db.transaction(async (manager) => {
          await editableCase(manager, caseId, true);
          await manager.query('INSERT INTO "attachments" ("id", "case_id", "kind", "object_key", "filename", "size", "deid_confirmed") VALUES ($1, $2, $3, $4, $5, $6, true)', [attachmentId, caseId, body.kind, key, filename, String(size)]);
          await manager.query('INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip") VALUES ($1, $2, $3, $4::jsonb, $5)', [actor.id, 'attachment.confirmed', `attachments:${attachmentId}`, JSON.stringify({ case_id: caseId, upload_id: id, page_count: state.page_count }), ip]);
        });
      } catch (error) {
        await this.compensation.compensate(intent);
        throw error;
      }
      await Promise.allSettled([this.compensation.complete(intent), this.redis.del(this.key(id)), rm(join(ROOT, id), { recursive: true, force: true })]);
      return { attachment_id: attachmentId, filename, size: String(size), deid_confirmed: true };
    });
  }

  async preview(caseValue: unknown, attachmentValue: unknown, pageValue: unknown, actor: AuthUser) {
    const caseId = caseUuid(caseValue), attachmentId = caseUuid(attachmentValue);
    const rows = await this.db.query(`SELECT a."object_key", a."filename" FROM "attachments" a JOIN "cases" c ON c."id" = a."case_id" WHERE a."id" = $1 AND a."case_id" = $2 AND a."deleted_at" IS NULL AND a."deid_confirmed" = true AND c."deleted_at" IS NULL`, [attachmentId, caseId]) as Array<{ object_key: string; filename: string }>;
    const item = rows[0];
    if (!item || !item.object_key.startsWith(`cases/${caseId}/`)) throw new NotFoundException('安全预览不存在');
    const count = item.filename === 'key-image.png' ? 1 : await this.objects.pageCount(item.object_key);
    const page = this.page(pageValue, count);
    const bytes = await this.objects.readPng(item.filename === 'key-image.png' ? item.object_key : `${item.object_key}/page-${page}.png`);
    return { image: await watermarkPreview(bytes, actor), page_count: count };
  }

  private async process(state: UploadState) {
    const dir = join(ROOT, state.id), input = join(dir, `input.${state.format}`);
    try {
      await writeFile(input, '', { flag: 'wx', mode: 0o600 });
      for (let i = 0; i < state.part_count; i++) {
        await appendFile(input, await readFile(join(dir, `part-${i}`)));
        await rm(join(dir, `part-${i}`));
      }
      const result = await this.worker.processAttachment(input, join(dir, 'processed'), state.format);
      if (!Number.isInteger(result.page_count) || result.page_count < 1 || result.page_count > 100) throw new Error('Invalid processed pages');
      // Keep only the approved pixel pages, never conversion inputs or profile files.
      for (const entry of await readdir(join(dir, 'processed'))) {
        if (!/^page-[1-9]\d*\.png$/.test(entry)) await rm(join(dir, 'processed', entry), { recursive: true, force: true });
      }
      await rm(input, { force: true });
      state.page_count = result.page_count;
      state.status = 'pending_confirmation';
    } catch {
      state.status = 'failed';
      state.failure_code = 'ATTACHMENT_PROCESSING_FAILED';
      await rm(dir, { recursive: true, force: true });
    }
    await this.save(state);
  }

  private async state(caseId: string, id: string, actor: AuthUser): Promise<UploadState> {
    const serialized = await this.redis.get(this.key(id));
    if (!serialized) throw new NotFoundException('上传会话不存在或已失效');
    const state = JSON.parse(serialized) as UploadState;
    if (state.id !== id || state.case_id !== caseId || state.actor_id !== actor.id || state.expires_at <= Date.now()) throw new NotFoundException('上传会话不存在或已失效');
    await editableCase(this.db, caseId);
    return state;
  }
  private async save(state: UploadState) {
    const remaining = Math.floor((state.expires_at - Date.now()) / 1000);
    if (remaining <= 0) throw new NotFoundException('上传会话已失效');
    await this.redis.set(this.key(state.id), JSON.stringify(state), { EX: remaining });
  }
  private key(id: string) { return `miap:attachment:${id}`; }
  private page(value: unknown, count: number) {
    const page = value === undefined ? 1 : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(page) || page < 1 || page > count) throw new NotFoundException('预览页不存在');
    return page;
  }
  private async lock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const key = `miap:attachment:lock:${id}`, token = randomUUID();
    if (await this.redis.set(key, token, { NX: true, EX: 600 }) !== 'OK') throw new ConflictException('附件正在处理中');
    try { return await action(); }
    finally { await this.redis.eval('if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', { keys: [key], arguments: [token] }).catch(() => undefined); }
  }
  private async cleanup() {
    for (const entry of await readdir(ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || !CASE_UUID.test(entry.name)) continue;
      const path = join(ROOT, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - (info.birthtimeMs || info.mtimeMs) >= (TTL - 60) * 1000) {
        await rm(path, { recursive: true, force: true });
        await this.redis.del(this.key(entry.name));
      }
    }
  }
}
