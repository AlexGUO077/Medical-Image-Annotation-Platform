import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { CONFIRM_METHODS, IMPORT_SOURCES } from './cases-import.models';
import { MANUAL_QUARANTINE_ROOT } from './cases-import.paths';
import { DeidWorkerService } from './deid-worker.service';
import { ObjectCompensationService } from './object-compensation.service';
import { MaskMapService } from './mask-map.service';

export const CASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function caseUuid(value: unknown): string {
  if (typeof value !== 'string' || !CASE_UUID.test(value)) throw new BadRequestException('标识必须是 UUID');
  return value;
}
export async function editableCase(db: Pick<EntityManager, 'query'>, id: string, lock = false): Promise<void> {
  const rows = await db.query(`SELECT "status", "source" FROM "cases" WHERE "id" = $1 AND "deleted_at" IS NULL${lock ? ' FOR UPDATE' : ''}`, [id]) as Array<{ status: string; source: string }>;
  if (!rows[0]) throw new NotFoundException('病例不存在');
  if (!['已录入', '待分配'].includes(rows[0].status)) throw new ConflictException('病例当前状态不允许编辑');
  if (!IMPORT_SOURCES.includes(rows[0].source as never)) throw new ConflictException('病例来源未获批准');
}

@Injectable()
export class CasesClinicalService {
  constructor(
    @Inject(DATABASE_SOURCE) private readonly db: DataSource,
    private readonly worker: DeidWorkerService,
    private readonly maps: MaskMapService,
    private readonly compensation: ObjectCompensationService,
  ) {}

  async save(idValue: unknown, actor: AuthUser, body: unknown, teaching: boolean, ip: string) {
    const id = caseUuid(idValue);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('请求无效');
    const input = body as Record<string, unknown>;
    const text = (key: string, max: number) => {
      const value = input[key];
      if (typeof value !== 'string' || Buffer.byteLength(value) > max) throw new BadRequestException('文本为空或超过限制');
      return value;
    };
    let fields: string[];
    if (teaching) {
      if (!Array.isArray(input.sign_points) || input.sign_points.length > 50 ||
          !input.sign_points.every((v) => typeof v === 'string' && Buffer.byteLength(v) <= 1000)) {
        throw new BadRequestException('征象要点格式或长度无效');
      }
      fields = [text('difficulty', 100), text('applicable_level', 100), ...input.sign_points as string[]];
    } else {
      if (!CONFIRM_METHODS.includes(input.confirm_method as never)) throw new BadRequestException('确诊方式无效');
      fields = [text('clinical_text', 2 * 1024 * 1024), text('age_band', 100), text('sex', 100)];
    }
    await editableCase(this.db, id);
    await mkdir(MANUAL_QUARANTINE_ROOT, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(MANUAL_QUARANTINE_ROOT, 'text-'));
    const reservedMapId = randomUUID();
    let intent: string | undefined;
    let mapId: string | null = null;
    let committed = false;
    try {
      const path = join(dir, 'input.json');
      await writeFile(path, JSON.stringify(fields), { mode: 0o600 });
      const result = await this.worker.processText(path, dir);
      if (result.fields.length !== fields.length || !result.fields.every((v) => typeof v === 'string') ||
          !Number.isInteger(result.masked_count) || result.masked_count < 0) throw new ConflictException('脱敏结果无效');
      const safe = teaching ? { difficulty: result.fields[0], applicable_level: result.fields[1], sign_points: result.fields.slice(2) }
        : { clinical_text: result.fields[0], age_band: result.fields[1], sex: result.fields[2], confirm_method: input.confirm_method };
      intent = await this.compensation.reserve(null, 0, reservedMapId);
      mapId = await this.maps.storeFromFile(join(dir, 'mask-map.json'), reservedMapId);
      await this.db.transaction(async (manager) => {
        await editableCase(manager, id, true);
        if (teaching) {
          await manager.query('UPDATE "cases" SET "teaching_fields" = $2::jsonb, "updated_at" = now() WHERE "id" = $1', [id, JSON.stringify(safe)]);
        } else {
          await manager.query('UPDATE "cases" SET "clinical_text" = $2, "age_band" = $3, "sex" = $4, "confirm_method" = $5, "updated_at" = now() WHERE "id" = $1', [id, ...result.fields, input.confirm_method]);
        }
        await manager.query('INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip") VALUES ($1, $2, $3, $4::jsonb, $5)',
          [actor.id, teaching ? 'case.teaching_updated' : 'case.clinical_updated', `cases:${id}`, JSON.stringify({ masked_count: result.masked_count, mask_map_id: mapId }), ip]);
      });
      committed = true;
      return { ...safe, masked_count: result.masked_count };
    } finally {
      if (intent) {
        if (committed) await this.compensation.complete(intent).catch(() => undefined);
        else await this.compensation.compensate(intent);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }
}
