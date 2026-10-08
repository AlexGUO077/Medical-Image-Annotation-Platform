import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { watermarkPreview } from './case-preview';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { AuditService } from '../audit/audit.service';
import { DATABASE_SOURCE } from '../database/database.tokens';
import type {
  ConfirmMethod,
  ImportBatch,
  ImportFailure,
  ImportItem,
  ImportSource,
  ProcessedSeries,
  SourceRecord,
  SystemCode,
} from './cases-import.models';
import { CONFIRM_METHODS, SYSTEM_CODES } from './cases-import.models';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { DeidWorkerService } from './deid-worker.service';
import { ImportStoreService } from './import-store.service';
import { MaskMapService } from './mask-map.service';
import { OrthancService } from './orthanc.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/i;
const SOURCE_POLICIES = {
  synthetic: {
    scope: 'development_test_only',
    real_data_allowed: false,
    authorization_basis: 'synthetic_data',
    valid_until: 'project_acceptance',
    withdrawal_action: 'stop_import_and_delete',
    decision: 'D-31',
    case_prefix: 'SYN',
  },
  teacher_provided_teaching: {
    scope: 'development_test_only',
    real_data_allowed: true,
    authorization_basis: 'project_owner_confirmation',
    valid_until: 'project_acceptance',
    withdrawal_action: 'stop_import_and_delete',
    decision: 'D-31',
    case_prefix: 'TPT',
  },
} as const satisfies Record<ImportSource, Omit<SourceRecord, 'source' | 'recorded_by' | 'recorded_at'> & { case_prefix: string }>;

interface ConfirmInput {
  confirmed: true;
  systemCode: SystemCode;
  confirmMethod: ConfirmMethod;
}

@Injectable()
export class CasesImportService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(DATABASE_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly store: ImportStoreService,
    private readonly worker: DeidWorkerService,
    private readonly maskMaps: MaskMapService,
    private readonly orthanc: OrthancService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.IMPORT_QUEUE_DISABLED === 'true') return;
    await this.store.recoverInterrupted();
    this.timer = setInterval(() => void this.drainQueue(), 500);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async acceptUpload(actor: AuthUser, file: Express.Multer.File | undefined, sourceValue: unknown, ip: string) {
    const uploadedPath = file ? this.uploadedPath(file) : null;
    if (typeof sourceValue !== 'string' || !Object.hasOwn(SOURCE_POLICIES, sourceValue)) {
      if (uploadedPath) await rm(uploadedPath, { force: true });
      throw new BadRequestException('导入来源未获批准');
    }
    const source = sourceValue as ImportSource;
    const policy = SOURCE_POLICIES[source];
    if (!file || !uploadedPath) throw new BadRequestException('缺少 ZIP 文件');
    await this.assertZipSignature(uploadedPath);

    const batchId = randomUUID();
    const batchPath = join(IMPORT_QUARANTINE_ROOT, batchId);
    const zipPath = join(batchPath, 'upload.zip');
    await mkdir(batchPath, { recursive: false });
    await rename(uploadedPath, zipPath);

    try {
      const inspection = await this.worker.inspectZip(zipPath, join(batchPath, 'items'));
      await rm(zipPath, { force: true });
      const now = new Date().toISOString();
      const batch: ImportBatch = {
        batch_id: batchId,
        source,
        source_record: {
          source,
          scope: 'development_test_only',
          real_data_allowed: policy.real_data_allowed,
          authorization_basis: policy.authorization_basis,
          valid_until: policy.valid_until,
          withdrawal_action: policy.withdrawal_action,
          decision: 'D-31',
          recorded_by: actor.id,
          recorded_at: now,
        },
        actor_id: actor.id,
        request_ip: ip,
        quarantine_path: batchPath,
        status: 'queued',
        stage: 'queued',
        created_at: now,
        updated_at: now,
        items: inspection.items.map((item): ImportItem => ({
          item_id: randomUUID(),
          display_name: item.display_name,
          quarantine_path: item.path,
          status: 'queued',
          stage: 'queued',
          failure: null,
          review: null,
          processed: null,
          case_id: null,
        })),
      };
      if (batch.items.length === 0) throw new BadRequestException('ZIP 中没有病例');
      await this.store.create(batch);
      try {
        await this.audit.record(actor.id, 'case_import.batch_accepted', `import_batch:${batchId}`, {
          batch_id: batchId,
          source,
          scope: batch.source_record.scope,
          authorization_basis: batch.source_record.authorization_basis,
          valid_until: batch.source_record.valid_until,
          withdrawal_action: batch.source_record.withdrawal_action,
          file_count: inspection.file_count,
          compressed_size: inspection.compressed_size,
          expanded_size: inspection.expanded_size,
        }, ip);
      } catch (error) {
        await this.store.remove(batchId);
        throw error;
      }
      await Promise.all(batch.items.map((item) => this.store.enqueue({ batch_id: batchId, item_id: item.item_id })));
      return {
        batch_id: batchId,
        status: 'queued',
        source,
        source_record: {
          scope: batch.source_record.scope,
          real_data_allowed: batch.source_record.real_data_allowed,
          authorization_basis: batch.source_record.authorization_basis,
          valid_until: batch.source_record.valid_until,
          withdrawal_action: batch.source_record.withdrawal_action,
          decision: 'D-31',
        },
      };
    } catch (error) {
      await rm(batchPath, { recursive: true, force: true });
      throw error;
    }
  }

  async progress(batchIdValue: unknown) {
    const batch = await this.store.get(this.uuid(batchIdValue, 'batchId'));
    return this.store.progress(batch);
  }

  async preview(batchIdValue: unknown, itemIdValue: unknown, actor: AuthUser): Promise<Buffer> {
    const { item } = await this.findItem(batchIdValue, itemIdValue);
    if (item.status !== 'awaiting_confirmation' || !item.processed) {
      throw new ConflictException('当前病例不能预览脱敏结果');
    }
    return watermarkPreview(await readFile(item.processed.preview_path), actor);
  }

  async confirm(
    batchIdValue: unknown,
    itemIdValue: unknown,
    actor: AuthUser,
    body: unknown,
    ip: string,
  ) {
    const input = this.confirmInput(body);
    const { batch, item } = await this.findItem(batchIdValue, itemIdValue);
    if (item.status === 'completed' && item.case_id) {
      await rm(item.quarantine_path, { recursive: true, force: true });
      await this.cleanupCompletedBatch(batch);
      return { batch_id: batch.batch_id, item_id: item.item_id, case_id: item.case_id, status: 'completed', case_status: '已录入' };
    }
    if (item.status !== 'awaiting_confirmation' || !item.processed || !item.review) {
      throw new ConflictException('病例尚未完成自动脱敏或当前状态不能确认');
    }
    if (!this.sourceRecordValid(batch)) {
      throw new ConflictException('导入批次来源记录无效');
    }
    if (await this.isDuplicate(batch.source, item.processed.study_uid)) {
      item.status = 'duplicate';
      item.stage = 'duplicate';
      item.processed = null;
      item.review = null;
      await this.audit.record(actor.id, 'case_import.duplicate_skipped', `import_batch:${batch.batch_id}`, {
        batch_id: batch.batch_id,
        source: batch.source,
        item_id: item.item_id,
      }, ip);
      this.store.refreshStatus(batch);
      await this.store.save(batch);
      await rm(item.quarantine_path, { recursive: true, force: true });
      await this.cleanupCompletedBatch(batch);
      return { batch_id: batch.batch_id, item_id: item.item_id, status: 'duplicate' };
    }

    const orthancSeriesIds: string[] = [];
    const createdOrthancSeriesIds: string[] = [];
    let maskMapId: string | null = null;
    let caseId: string;
    try {
      for (const series of item.processed.series) {
        const uploaded = await this.orthanc.uploadSeries(series.dicom_paths);
        orthancSeriesIds.push(uploaded.id);
        if (uploaded.created) createdOrthancSeriesIds.push(uploaded.id);
      }
      maskMapId = await this.maskMaps.storeFromFile(item.processed.mask_map_path);
      const maskedReport = item.processed.masked_report_path
        ? await readFile(item.processed.masked_report_path, 'utf8')
        : null;
      caseId = await this.commitCase(
        batch,
        item,
        input,
        actor.id,
        ip,
        orthancSeriesIds,
        maskMapId,
        maskedReport,
      );
    } catch (error) {
      await this.orthanc.removeSeries(createdOrthancSeriesIds);
      await this.maskMaps.remove(maskMapId);
      throw error;
    }

    // Once the database transaction commits, formal storage must never be
    // compensated because a later quarantine cleanup or audit write fails.
    item.status = 'completed';
    item.stage = 'completed';
    item.case_id = caseId;
    item.processed = null;
    item.review = null;
    this.store.refreshStatus(batch);
    await this.store.save(batch);
    await rm(item.quarantine_path, { recursive: true, force: true });
    await this.audit.record(actor.id, 'case_import.quarantine_cleaned', `cases:${caseId}`, {
      batch_id: batch.batch_id,
      source: batch.source,
      item_id: item.item_id,
    }, ip);
    await this.cleanupCompletedBatch(batch);
    return { batch_id: batch.batch_id, item_id: item.item_id, case_id: caseId, status: 'completed', case_status: '已录入' };
  }

  async auditMaskMap(caseIdValue: unknown, actor: AuthUser, body: unknown, ip: string) {
    const caseId = this.uuid(caseIdValue, 'caseId');
    const reason = this.reason(body);
    const rows = await this.dataSource.query(
      `SELECT r."mask_map_id"
       FROM "reports" r JOIN "cases" c ON c."id" = r."case_id"
       WHERE c."id" = $1 AND c."deleted_at" IS NULL AND r."deleted_at" IS NULL`,
      [caseId],
    ) as Array<{ mask_map_id: string | null }>;
    if (!rows[0]) throw new NotFoundException('病例报告不存在');
    const mapId = rows[0].mask_map_id;
    const mappings = mapId ? await this.maskMaps.read(mapId) : [];
    await this.audit.record(actor.id, 'case_import.mask_map_accessed', `cases:${caseId}`, {
      case_id: caseId,
      mask_map_id: mapId,
      reason,
    }, ip);
    return { case_id: caseId, mappings };
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const message = await this.store.dequeue();
        if (!message) break;
        try {
          await this.processItem(message.batch_id, message.item_id);
          await this.store.acknowledge(message);
        } catch {
          await this.store.retry(message);
          break;
        }
      }
    } catch {
      return;
    } finally {
      this.draining = false;
    }
  }

  private async processItem(batchId: string, itemId: string): Promise<void> {
    let batch: ImportBatch;
    try {
      batch = await this.store.get(batchId);
    } catch {
      return;
    }
    const item = batch.items.find((candidate) => candidate.item_id === itemId);
    if (!item) return;
    if (item.status === 'duplicate' || item.status === 'failed') {
      await rm(item.quarantine_path, { recursive: true, force: true });
      await this.cleanupCompletedBatch(batch);
      return;
    }
    if (item.status !== 'queued' && item.status !== 'processing') return;
    const hasProcessingCheckpoint = Boolean(item.processed && item.review);
    item.status = 'processing';
    item.stage = hasProcessingCheckpoint ? 'duplicate_check' : 'deidentification';
    this.store.refreshStatus(batch);
    await this.store.save(batch);
    let result: Awaited<ReturnType<DeidWorkerService['processCase']>>;
    if (hasProcessingCheckpoint && item.processed && item.review) {
      result = { processed: item.processed, review: item.review };
    } else {
      try {
        result = await this.worker.processCase(item.quarantine_path, join(item.quarantine_path, 'processed'));
      } catch (error) {
        item.status = 'failed';
        item.stage = 'failed';
        item.failure = this.failure(error);
        item.review = null;
        item.processed = null;
        await this.audit.record(batch.actor_id, 'case_import.case_failed', `import_batch:${batch.batch_id}`, {
          batch_id: batch.batch_id,
          source: batch.source,
          item_id: item.item_id,
          failure_code: item.failure.code,
        }, batch.request_ip);
        this.store.refreshStatus(batch);
        await this.store.save(batch);
        await rm(item.quarantine_path, { recursive: true, force: true });
        await this.cleanupCompletedBatch(batch);
        return;
      }
      item.review = result.review;
      item.processed = result.processed;
      item.failure = null;
      item.stage = 'duplicate_check';
      this.store.refreshStatus(batch);
      await this.store.save(batch);
    }
    if (await this.isDuplicate(batch.source, result.processed.study_uid)) {
      item.status = 'duplicate';
      item.stage = 'duplicate';
      await this.audit.record(batch.actor_id, 'case_import.duplicate_skipped', `import_batch:${batch.batch_id}`, {
        batch_id: batch.batch_id,
        source: batch.source,
        item_id: item.item_id,
      }, batch.request_ip);
      this.store.refreshStatus(batch);
      await this.store.save(batch);
      await rm(item.quarantine_path, { recursive: true, force: true });
      await this.cleanupCompletedBatch(batch);
      return;
    }
    item.review = result.review;
    item.processed = result.processed;
    item.status = 'awaiting_confirmation';
    item.stage = 'manual_confirmation';
    this.store.refreshStatus(batch);
    await this.store.save(batch);
  }

  private async commitCase(
    batch: ImportBatch,
    item: ImportItem,
    input: ConfirmInput,
    actorId: string,
    ip: string,
    orthancSeriesIds: string[],
    maskMapId: string | null,
    maskedReport: string | null,
  ): Promise<string> {
    const processed = item.processed;
    if (!processed || processed.series.length !== orthancSeriesIds.length) throw new Error('处理结果不完整');
    return this.dataSource.transaction(async (manager) => {
      const duplicate = await manager.query(
        `SELECT 1 FROM "studies" s JOIN "cases" c ON c."id" = s."case_id"
         WHERE c."source" = $1 AND s."study_uid" = $2 AND c."deleted_at" IS NULL AND s."deleted_at" IS NULL
         LIMIT 1 FOR UPDATE`,
        [batch.source, processed.study_uid],
      ) as unknown[];
      if (duplicate.length > 0) throw new ConflictException('病例已存在');
      const caseRows = await manager.query(
        `INSERT INTO "cases" ("case_no", "status", "source", "system_code", "confirm_method")
         VALUES ($1, '已录入', $2, $3, $4) RETURNING "id"`,
        [`${SOURCE_POLICIES[batch.source].case_prefix}-${randomUUID().slice(0, 12).toUpperCase()}`, batch.source, input.systemCode, input.confirmMethod],
      ) as Array<{ id: string }>;
      const caseId = caseRows[0]?.id;
      if (!caseId) throw new Error('病例写入失败');
      const studyRows = await manager.query(
        `INSERT INTO "studies" ("case_id", "study_uid", "study_date") VALUES ($1, $2, $3) RETURNING "id"`,
        [caseId, processed.study_uid, processed.study_date],
      ) as Array<{ id: string }>;
      const studyId = studyRows[0]?.id;
      if (!studyId) throw new Error('检查写入失败');
      for (let index = 0; index < processed.series.length; index += 1) {
        await this.insertSeries(manager, studyId, processed.series[index], orthancSeriesIds[index]);
      }
      if (maskedReport !== null) {
        await manager.query(
          `INSERT INTO "reports" ("case_id", "raw_text", "sentences", "mask_map_id")
           VALUES ($1, $2, $3::jsonb, $4)`,
          [caseId, maskedReport, JSON.stringify(this.sentences(maskedReport)), maskMapId],
        );
      }
      await this.auditInTransaction(manager, actorId, 'case_import.deidentification_confirmed', `cases:${caseId}`, {
        batch_id: batch.batch_id,
        source: batch.source,
        authorization_basis: batch.source_record.authorization_basis,
        valid_until: batch.source_record.valid_until,
        withdrawal_action: batch.source_record.withdrawal_action,
        item_id: item.item_id,
        system_code: input.systemCode,
        confirm_method: input.confirmMethod,
      }, ip);
      await this.auditInTransaction(manager, actorId, 'case_import.case_committed', `cases:${caseId}`, {
        batch_id: batch.batch_id,
        source: batch.source,
        authorization_basis: batch.source_record.authorization_basis,
        valid_until: batch.source_record.valid_until,
        withdrawal_action: batch.source_record.withdrawal_action,
        item_id: item.item_id,
        study_uid: processed.study_uid,
        series_count: processed.series.length,
      }, ip);
      return caseId;
    });
  }

  private async insertSeries(
    manager: EntityManager,
    studyId: string,
    series: ProcessedSeries | undefined,
    orthancId: string | undefined,
  ): Promise<void> {
    if (!series || !orthancId) throw new Error('序列处理结果不完整');
    await manager.query(
      `INSERT INTO "series" ("study_id", "modality", "series_uid", "orthanc_id", "frame_count", "default_window")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [studyId, series.modality, series.series_uid, orthancId, series.frame_count,
        series.default_window === null ? null : JSON.stringify(series.default_window)],
    );
  }

  private async auditInTransaction(
    manager: EntityManager,
    actor: string,
    action: string,
    target: string,
    detail: Record<string, unknown>,
    ip: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip") VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [actor, action, target, JSON.stringify(detail), ip],
    );
  }

  private async isDuplicate(source: ImportSource, studyUid: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM "studies" s JOIN "cases" c ON c."id" = s."case_id"
       WHERE c."source" = $1 AND s."study_uid" = $2
         AND c."deleted_at" IS NULL AND s."deleted_at" IS NULL LIMIT 1`,
      [source, studyUid],
    ) as unknown[];
    return rows.length > 0;
  }

  private sourceRecordValid(batch: ImportBatch): boolean {
    const policy = SOURCE_POLICIES[batch.source];
    const record = batch.source_record;
    return Boolean(policy)
      && record.source === batch.source
      && record.scope === policy.scope
      && record.real_data_allowed === policy.real_data_allowed
      && record.authorization_basis === policy.authorization_basis
      && record.valid_until === policy.valid_until
      && record.withdrawal_action === policy.withdrawal_action
      && record.decision === policy.decision;
  }

  private async findItem(batchIdValue: unknown, itemIdValue: unknown): Promise<{ batch: ImportBatch; item: ImportItem }> {
    const batch = await this.store.get(this.uuid(batchIdValue, 'batchId'));
    const itemId = this.uuid(itemIdValue, 'itemId');
    const item = batch.items.find((candidate) => candidate.item_id === itemId);
    if (!item) throw new NotFoundException('导入病例不存在');
    return { batch, item };
  }

  private confirmInput(body: unknown): ConfirmInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('脱敏确认请求无效');
    const record = body as Record<string, unknown>;
    if (record.confirmed !== true) throw new BadRequestException('confirmed 必须为 true');
    if (typeof record.system_code !== 'string' || !SYSTEM_CODES.includes(record.system_code as SystemCode)) {
      throw new BadRequestException('system_code 无效');
    }
    if (typeof record.confirm_method !== 'string' || !CONFIRM_METHODS.includes(record.confirm_method as ConfirmMethod)) {
      throw new BadRequestException('confirm_method 无效');
    }
    return { confirmed: true, systemCode: record.system_code as SystemCode, confirmMethod: record.confirm_method as ConfirmMethod };
  }

  private reason(body: unknown): string {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('审计读取请求无效');
    const value = (body as Record<string, unknown>).reason;
    if (typeof value !== 'string' || value.trim().length < 4 || value.trim().length > 200) {
      throw new BadRequestException('reason 长度必须为 4～200 个字符');
    }
    return value.trim();
  }

  private sentences(text: string): Array<{ idx: number; text: string }> {
    return text.split(/[。；;\n]/u).map((value) => value.trim()).filter(Boolean).map((value, idx) => ({ idx, text: value }));
  }

  private failure(error: unknown): ImportFailure {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object') {
        const record = response as Record<string, unknown>;
        return {
          code: typeof record.code === 'string' ? record.code : 'DEIDENTIFICATION_FAILED',
          message: typeof record.message === 'string' ? record.message : '病例处理失败',
        };
      }
    }
    return { code: 'DEIDENTIFICATION_FAILED', message: '病例处理失败' };
  }

  private async assertZipSignature(path: string): Promise<void> {
    const handle = await open(path, 'r');
    const bytes = Buffer.alloc(4);
    try {
      await handle.read(bytes, 0, 4, 0);
    } finally {
      await handle.close();
    }
    const signature = bytes.toString('hex');
    if (!['504b0304', '504b0506', '504b0708'].includes(signature)) {
      await rm(path, { force: true });
      throw new UnsupportedMediaTypeException('上传文件不是有效 ZIP');
    }
  }

  private uploadedPath(file: Express.Multer.File): string {
    const name = basename(file.path);
    if (name !== file.filename || !UPLOAD_NAME_PATTERN.test(name)) {
      throw new BadRequestException('上传文件路径无效');
    }
    return join(IMPORT_QUARANTINE_ROOT, name);
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BadRequestException(`${field} 必须是 UUID`);
    return value;
  }

  private async cleanupCompletedBatch(batch: ImportBatch): Promise<void> {
    if (batch.items.some((item) => ['queued', 'processing', 'awaiting_confirmation'].includes(item.status))) return;
    await rm(batch.quarantine_path, { recursive: true, force: true });
  }
}
