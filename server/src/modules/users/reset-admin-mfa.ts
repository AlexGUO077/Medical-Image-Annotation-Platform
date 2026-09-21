import { AppDataSource } from '../../database/data-source';
import { requiredEnv } from '../../config/environment';

async function main(): Promise<void> {
  const username = requiredEnv('MFA_RESET_USERNAME');
  await AppDataSource.initialize();
  try {
    const rows = await AppDataSource.query(
      `UPDATE "users"
       SET "mfa_secret_encrypted" = NULL, "updated_at" = now()
       WHERE "username" = $1 AND "role" = 'admin' AND "deleted_at" IS NULL
       RETURNING "id"`,
      [username],
    ) as Array<{ id: string }>;
    const user = rows[0];
    if (!user) throw new Error('Admin account not found');
    await AppDataSource.query(
      `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
       VALUES ($1, 'auth.mfa_emergency_reset', $2, '{"source":"local-command"}'::jsonb, 'local')`,
      [user.id, `users:${user.id}`],
    );
    console.log('Administrator MFA reset completed; the account must bind Microsoft Authenticator again.');
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Administrator MFA reset failed');
  process.exitCode = 1;
});
