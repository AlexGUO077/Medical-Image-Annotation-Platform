import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_SOURCE) private readonly dataSource: DataSource) {}

  async record(
    actor: string,
    action: string,
    target: string,
    detail: Record<string, unknown>,
    ip: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "audit_logs" ("actor", "action", "target", "detail", "ip")
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [actor, action, target, JSON.stringify(detail), ip],
    );
  }
}
