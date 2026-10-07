import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { AttachmentObjectService } from './attachment-object.service';
import { IMPORT_QUARANTINE_ROOT } from './cases-import.paths';
import { MaskMapService } from './mask-map.service';

const ROOT = join(IMPORT_QUARANTINE_ROOT, 'object-compensation');
interface Intent { id: string; key: string | null; pages: number; mapping: string | null; retry_after: number }

// Contains server-generated keys only, never medical content. Retained until compensation succeeds.
@Injectable()
export class ObjectCompensationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource,
    private readonly objects: AttachmentObjectService, private readonly maps: MaskMapService) {}
  async onModuleInit() {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    await this.retry();
    this.timer = setInterval(() => void this.retry().catch(() => undefined), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async reserve(key: string | null, pages: number, mapping: string | null = null): Promise<string> {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    // Longer than the confirmation lock; covers process interruption and uncertain PUT results.
    await writeFile(join(ROOT, `${id}.json`), JSON.stringify({ id, key, pages, mapping, retry_after: Date.now() + 15 * 60_000 } satisfies Intent), { mode: 0o600, flag: 'wx' });
    return id;
  }
  async complete(id: string) { await rm(join(ROOT, `${id}.json`), { force: true }); }
  async compensate(id: string): Promise<void> {
    try {
      const intent = JSON.parse(await readFile(join(ROOT, `${id}.json`), 'utf8')) as Intent;
      // A transaction may have committed even if its response was lost. Never delete referenced objects.
      if (intent.key) {
        const used = await this.db.query(`SELECT 1 FROM "attachments" WHERE "object_key" = $1
          UNION ALL SELECT 1 FROM export_requests WHERE 'exports/'||id::text||'.json'=$1 AND status='已批准' LIMIT 1`, [intent.key]) as unknown[];
        if (used.length === 0) {
          if (intent.pages === 0) await this.objects.remove(intent.key);
          else await this.objects.removePages(intent.key, intent.pages);
        }
      }
      if (intent.mapping) {
        const used = await this.db.query(`SELECT 1 FROM "reports" WHERE "mask_map_id" = $1 UNION ALL SELECT 1 FROM "audit_logs" WHERE "detail"->>'mask_map_id' = $1::text LIMIT 1`, [intent.mapping]) as unknown[];
        if (used.length === 0) await this.maps.remove(intent.mapping);
      }
      await this.complete(id);
    } catch {
      // The durable record is the retry queue. A DB or object-store outage cannot erase it.
    }
  }
  private async retry() {
    if (this.running) return;
    this.running = true;
    try {
      for (const name of await readdir(ROOT)) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        try {
          const intent = JSON.parse(await readFile(join(ROOT, name), 'utf8')) as Intent;
          if (intent.retry_after <= Date.now()) await this.compensate(intent.id);
        } catch { /* Preserve unreadable records for investigation; never guess object keys. */ }
      }
    } finally { this.running = false; }
  }
}
