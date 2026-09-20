import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { hashSeedPassword } from './password';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SYSTEMS = [
  ['cns', '中枢神经系统'],
  ['headneck', '头颈'],
  ['resp', '呼吸'],
  ['circ', '循环'],
  ['digest', '消化'],
  ['uro', '泌尿'],
  ['repro', '生殖'],
  ['bone', '骨骼'],
] as const;

export async function seedDatabase(dataSource: DataSource, adminPassword: string): Promise<void> {
  if (adminPassword.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must contain at least 12 characters');
  }

  const passwordHash = hashSeedPassword(adminPassword);
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO "users" (
        "id", "username", "password_hash", "real_name", "role", "quals", "status", "expire_at"
      ) VALUES ($1, $2, $3, $4, 'admin', '{}'::jsonb, 'active', DATE '2099-12-31')
      ON CONFLICT DO NOTHING`,
      [ADMIN_ID, 'admin', passwordHash, '合成数据管理员'],
    );

    for (const [index, [systemCode, systemName]] of SYSTEMS.entries()) {
      const suffix = String(index + 1).padStart(12, '0');
      await manager.query(
        `INSERT INTO "taxonomy_nodes" ("id", "parent_id", "level", "name", "synonyms", "icd")
         VALUES ($1, NULL, 1, $2, '[]'::jsonb, NULL)
         ON CONFLICT DO NOTHING`,
        [`10000000-0000-4000-8000-${suffix}`, systemName],
      );
      await manager.query(
        `INSERT INTO "sign_tags" ("id", "name", "system_code", "definition")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [
          `20000000-0000-4000-8000-${suffix}`,
          `合成示例征象-${systemCode}`,
          systemCode,
          '仅用于合成数据开发验证，不作为医学判断依据。',
        ],
      );
    }
  });
}

async function main(): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is required');
  await AppDataSource.initialize();
  try {
    await seedDatabase(AppDataSource, password);
    console.log('Database seed completed: 1 synthetic admin, 8 system roots, 8 synthetic sign tags.');
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database seed failed');
    process.exitCode = 1;
  });
}
