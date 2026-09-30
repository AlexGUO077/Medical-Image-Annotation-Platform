import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';

const SYSTEM_CODES = new Set(['cns', 'headneck', 'resp', 'circ', 'digest', 'uro', 'repro', 'bone']);
const SYSTEM_CODES_BY_NAME: Readonly<Record<string, string>> = {
  中枢神经系统: 'cns',
  头颈: 'headneck',
  呼吸: 'resp',
  循环: 'circ',
  消化: 'digest',
  泌尿: 'uro',
  生殖: 'repro',
  骨骼: 'bone',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TaxonomyRow {
  id: string;
  parent_id: string | null;
  level: number;
  name: string;
  synonyms: unknown;
  icd: string | null;
}

export interface SignTag {
  id: string;
  name: string;
  system_code: string;
  definition: string;
}

export interface TaxonomyNode extends Omit<TaxonomyRow, 'synonyms'> {
  synonyms: string[];
  children: TaxonomyNode[];
  sign_tags?: SignTag[];
}

interface NodeInput {
  name: string;
  synonyms: string[];
  icd: string | null;
}

interface SignTagInput {
  name: string;
  systemCode: string;
  definition: string;
}

@Injectable()
export class TaxonomyService {
  constructor(@Inject(DATABASE_SOURCE) private readonly dataSource: DataSource) {}

  async tree() {
    const [rows, signTags] = await Promise.all([
      this.dataSource.query(
        `SELECT "id", "parent_id", "level", "name", "synonyms", "icd"
         FROM "taxonomy_nodes"
         WHERE "deleted_at" IS NULL
         ORDER BY "level", "name", "id"`,
      ) as Promise<TaxonomyRow[]>,
      this.dataSource.query(
        `SELECT "id", "name", "system_code", "definition"
         FROM "sign_tags"
         WHERE "deleted_at" IS NULL
         ORDER BY "name", "id"`,
      ) as Promise<SignTag[]>,
    ]);

    const nodes = new Map<string, TaxonomyNode>();
    for (const row of rows) {
      if (!Array.isArray(row.synonyms) || row.synonyms.some((value) => typeof value !== 'string')) {
        throw new InternalServerErrorException('标签树同义词数据无效');
      }
      nodes.set(row.id, { ...row, synonyms: row.synonyms as string[], children: [] });
    }

    const roots: TaxonomyNode[] = [];
    for (const node of nodes.values()) {
      if (node.level === 1) {
        if (node.parent_id !== null) throw new InternalServerErrorException('标签树层级关系无效');
        roots.push(node);
        continue;
      }
      if (!node.parent_id) throw new InternalServerErrorException('标签树层级关系无效');
      const parent = nodes.get(node.parent_id);
      if (!parent || parent.level !== node.level - 1) {
        throw new InternalServerErrorException('标签树层级关系无效');
      }
      parent.children.push(node);
    }

    const signsBySystem = new Map<string, SignTag[]>();
    for (const tag of signTags) {
      const existing = signsBySystem.get(tag.system_code) ?? [];
      existing.push(tag);
      signsBySystem.set(tag.system_code, existing);
    }
    for (const root of roots) {
      const systemCode = SYSTEM_CODES_BY_NAME[root.name];
      if (!systemCode) throw new InternalServerErrorException('标签树包含未知系统根节点');
      this.attachDiseaseSigns(root, signsBySystem.get(systemCode) ?? []);
    }

    return { tree: roots, sign_tags: signTags };
  }

  async listSignTags(pageValue: unknown, pageSizeValue: unknown, systemCodeValue: unknown, keywordValue: unknown) {
    const page = this.pageNumber(pageValue, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.pageNumber(pageSizeValue, 20, 1, 100);
    const systemCode = systemCodeValue === undefined ? undefined : this.systemCode(systemCodeValue);
    if (keywordValue !== undefined && typeof keywordValue !== 'string') throw new BadRequestException('keyword 必须是字符串');
    const keyword = typeof keywordValue === 'string' ? keywordValue.trim() : '';
    const filters = ['"deleted_at" IS NULL'];
    const values: unknown[] = [];
    if (systemCode) filters.push(`"system_code" = $${values.push(systemCode)}`);
    if (keyword) filters.push(`"name" ILIKE '%' || $${values.push(keyword)} || '%'`);
    const where = filters.join(' AND ');
    const offset = (page - 1) * pageSize;
    const [items, totals] = await Promise.all([
      this.dataSource.query(
        `SELECT "id", "name", "system_code", "definition"
         FROM "sign_tags" WHERE ${where}
         ORDER BY "name", "id" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, offset],
      ) as Promise<SignTag[]>,
      this.dataSource.query(
        `SELECT count(*)::int AS "total" FROM "sign_tags" WHERE ${where}`,
        values,
      ) as Promise<Array<{ total: number }>>,
    ]);
    return { items, page, pageSize, total: totals[0]?.total ?? 0 };
  }

  async createNode(actor: AuthUser, body: unknown, ip: string) {
    const record = this.record(body, '标签节点创建请求无效');
    const parentId = this.uuid(record.parent_id, 'parent_id');
    const input = this.nodeInput(record);
    return this.withUniqueConflict(async () => this.dataSource.transaction(async (manager) => {
      const parent = await this.findNode(manager, parentId, '父节点不存在');
      if (parent.level >= 4) throw new BadRequestException('第 4 级节点不能新增子节点');
      const rows = await manager.query(
        `INSERT INTO "taxonomy_nodes" ("parent_id", "level", "name", "synonyms", "icd")
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING "id", "parent_id", "level", "name", "synonyms", "icd"`,
        [parent.id, parent.level + 1, input.name, JSON.stringify(input.synonyms), input.icd],
      ) as TaxonomyRow[];
      const created = this.nodeResult(rows[0]);
      await this.audit(manager, actor.id, 'taxonomy.node_created', `taxonomy_nodes:${created.id}`, {
        parent_id: created.parent_id,
        level: created.level,
        name: created.name,
        synonyms: created.synonyms,
        icd: created.icd,
      }, ip);
      return created;
    }));
  }

  async updateNode(actor: AuthUser, idValue: unknown, body: unknown, ip: string) {
    const id = this.uuid(idValue, 'id');
    const record = this.record(body, '标签节点更新请求无效');
    if ('parent_id' in record || 'level' in record) throw new BadRequestException('标签节点不支持移动或修改层级');
    const input = this.nodeInput(record);
    return this.withUniqueConflict(async () => this.dataSource.transaction(async (manager) => {
      const existing = await this.findNode(manager, id, '标签节点不存在');
      if (existing.level === 1) throw new ForbiddenException('系统根节点不可修改');
      await manager.query(
        `UPDATE "taxonomy_nodes"
         SET "name" = $1, "synonyms" = $2::jsonb, "icd" = $3, "updated_at" = now()
         WHERE "id" = $4 AND "deleted_at" IS NULL`,
        [input.name, JSON.stringify(input.synonyms), input.icd, id],
      );
      const updated = this.nodeResult(await this.findNode(manager, id, '标签节点不存在'));
      await this.audit(manager, actor.id, 'taxonomy.node_updated', `taxonomy_nodes:${id}`, {
        before: { name: existing.name, synonyms: this.synonyms(existing.synonyms), icd: existing.icd },
        after: { name: updated.name, synonyms: updated.synonyms, icd: updated.icd },
      }, ip);
      return updated;
    }));
  }

  async deleteNode(actor: AuthUser, idValue: unknown, ip: string) {
    const id = this.uuid(idValue, 'id');
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT id FROM taxonomy_nodes WHERE id=$1 FOR UPDATE', [id]);
      const existing = await this.findNode(manager, id, '标签节点不存在');
      if (existing.level === 1) throw new ForbiddenException('系统根节点不可删除');
      const refs = await manager.query(
        `SELECT
           EXISTS(SELECT 1 FROM "taxonomy_nodes" WHERE "parent_id" = $1 AND "deleted_at" IS NULL) AS "has_children",
           EXISTS(SELECT 1 FROM "cases" WHERE "disease_tag_id" = $1 AND "deleted_at" IS NULL) AS "used_by_cases",
           EXISTS(SELECT 1 FROM "annotation_objects" WHERE "part_id" = $1 AND "deleted_at" IS NULL) AS "used_by_annotations"`,
        [id],
      ) as Array<{ has_children: boolean; used_by_cases: boolean; used_by_annotations: boolean }>;
      const usage = refs[0];
      if (!usage) throw new InternalServerErrorException('标签引用检查失败');
      if (usage.has_children || usage.used_by_cases || usage.used_by_annotations) {
        throw new ConflictException('标签节点存在子节点或业务引用，不能删除');
      }
      await manager.query(
        `UPDATE "taxonomy_nodes" SET "deleted_at" = now(), "updated_at" = now()
         WHERE "id" = $1 AND "deleted_at" IS NULL`,
        [id],
      );
      await this.audit(manager, actor.id, 'taxonomy.node_deleted', `taxonomy_nodes:${id}`, {
        level: existing.level,
        name: existing.name,
      }, ip);
      return { id, deleted: true };
    });
  }

  async createSignTag(actor: AuthUser, body: unknown, ip: string) {
    const input = this.signTagInput(body);
    return this.withUniqueConflict(async () => this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `INSERT INTO "sign_tags" ("name", "system_code", "definition")
         VALUES ($1, $2, $3)
         RETURNING "id", "name", "system_code", "definition"`,
        [input.name, input.systemCode, input.definition],
      ) as SignTag[];
      const created = this.signResult(rows[0]);
      await this.audit(manager, actor.id, 'taxonomy.sign_created', `sign_tags:${created.id}`, {
        name: created.name,
        system_code: created.system_code,
        definition: created.definition,
      }, ip);
      return created;
    }));
  }

  async updateSignTag(actor: AuthUser, idValue: unknown, body: unknown, ip: string) {
    const id = this.uuid(idValue, 'id');
    const input = this.signTagInput(body);
    return this.withUniqueConflict(async () => this.dataSource.transaction(async (manager) => {
      const existing = await this.findSignTag(manager, id);
      await manager.query(
        `UPDATE "sign_tags"
         SET "name" = $1, "system_code" = $2, "definition" = $3, "updated_at" = now()
         WHERE "id" = $4 AND "deleted_at" IS NULL`,
        [input.name, input.systemCode, input.definition, id],
      );
      const updated = await this.findSignTag(manager, id);
      await this.audit(manager, actor.id, 'taxonomy.sign_updated', `sign_tags:${id}`, {
        before: existing,
        after: updated,
      }, ip);
      return updated;
    }));
  }

  async deleteSignTag(actor: AuthUser, idValue: unknown, ip: string) {
    const id = this.uuid(idValue, 'id');
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT id FROM sign_tags WHERE id=$1 FOR UPDATE', [id]);
      const existing = await this.findSignTag(manager, id);
      const refs = await manager.query(
        `SELECT EXISTS(
           SELECT 1 FROM "annotation_tags" WHERE "sign_tag_id" = $1 AND "deleted_at" IS NULL
         ) AS "used"`,
        [id],
      ) as Array<{ used: boolean }>;
      if (refs[0]?.used) throw new ConflictException('征象已被标注引用，不能删除');
      await manager.query(
        `UPDATE "sign_tags" SET "deleted_at" = now(), "updated_at" = now()
         WHERE "id" = $1 AND "deleted_at" IS NULL`,
        [id],
      );
      await this.audit(manager, actor.id, 'taxonomy.sign_deleted', `sign_tags:${id}`, {
        name: existing.name,
        system_code: existing.system_code,
      }, ip);
      return { id, deleted: true };
    });
  }

  private attachDiseaseSigns(node: TaxonomyNode, signTags: SignTag[]): void {
    if (node.level === 3) node.sign_tags = signTags;
    for (const child of node.children) this.attachDiseaseSigns(child, signTags);
  }

  private nodeInput(record: Record<string, unknown>): NodeInput {
    const name = this.requiredString(record.name, 'name');
    if (!('synonyms' in record)) throw new BadRequestException('synonyms 必填');
    const synonyms = this.synonyms(record.synonyms);
    return { name, synonyms, icd: this.optionalString(record.icd, 'icd') };
  }

  private signTagInput(body: unknown): SignTagInput {
    const record = this.record(body, '征象请求无效');
    return {
      name: this.requiredString(record.name, 'name'),
      systemCode: this.systemCode(record.system_code),
      definition: this.requiredString(record.definition, 'definition'),
    };
  }

  private record(body: unknown, message: string): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException(message);
    return body as Record<string, unknown>;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new BadRequestException(`${field} 必须是非空字符串`);
    return value.trim();
  }

  private optionalString(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException(`${field} 必须是字符串或 null`);
    return value.trim() || null;
  }

  private synonyms(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new BadRequestException('synonyms 必须是字符串数组');
    }
    return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  }

  private systemCode(value: unknown): string {
    if (typeof value !== 'string' || !SYSTEM_CODES.has(value)) throw new BadRequestException('system_code 无效');
    return value;
  }

  private uuid(value: unknown, field: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BadRequestException(`${field} 必须是 UUID`);
    return value;
  }

  private pageNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException('分页参数无效');
    return parsed;
  }

  private async findNode(manager: EntityManager, id: string, message: string): Promise<TaxonomyRow> {
    const rows = await manager.query(
      `SELECT "id", "parent_id", "level", "name", "synonyms", "icd"
       FROM "taxonomy_nodes" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [id],
    ) as TaxonomyRow[];
    const node = rows[0];
    if (!node) throw new NotFoundException(message);
    return node;
  }

  private async findSignTag(manager: EntityManager, id: string): Promise<SignTag> {
    const rows = await manager.query(
      `SELECT "id", "name", "system_code", "definition"
       FROM "sign_tags" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [id],
    ) as SignTag[];
    const sign = rows[0];
    if (!sign) throw new NotFoundException('征象不存在');
    return sign;
  }

  private nodeResult(row: TaxonomyRow | undefined): TaxonomyNode {
    if (!row) throw new InternalServerErrorException('标签节点写入未返回结果');
    return { ...row, synonyms: this.synonyms(row.synonyms), children: [] };
  }

  private signResult(row: SignTag | undefined): SignTag {
    if (!row) throw new InternalServerErrorException('征象写入未返回结果');
    return row;
  }

  private async audit(
    manager: EntityManager,
    actor: string,
    action: string,
    target: string,
    detail: Record<string, unknown>,
    ip: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [actor, action, target, JSON.stringify(detail), ip],
    );
  }

  private async withUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (this.postgresCode(error) === '23505') throw new ConflictException('活跃标签名称已存在');
      throw error;
    }
  }

  private postgresCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    const driverError = record.driverError;
    if (!driverError || typeof driverError !== 'object') return undefined;
    const code = (driverError as Record<string, unknown>).code;
    return typeof code === 'string' ? code : undefined;
  }
}
