import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';

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

  private attachDiseaseSigns(node: TaxonomyNode, signTags: SignTag[]): void {
    if (node.level === 3) node.sign_tags = signTags;
    for (const child of node.children) this.attachDiseaseSigns(child, signTags);
  }
}
