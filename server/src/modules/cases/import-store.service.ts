import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { ImportBatch, ImportProgress, ItemStatus, QueueMessage } from './cases-import.models';

const BATCH_PREFIX = 'miap:case-import:batch:';
const QUEUE_KEY = 'miap:case-import:queue';
const PROCESSING_QUEUE_KEY = 'miap:case-import:processing';
const BATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class ImportStoreService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  async create(batch: ImportBatch): Promise<void> {
    await this.redis.set(this.key(batch.batch_id), JSON.stringify(batch), { EX: BATCH_TTL_SECONDS, NX: true });
  }

  async get(batchId: string): Promise<ImportBatch> {
    const value = await this.redis.get(this.key(batchId));
    if (!value) throw new NotFoundException('导入批次不存在或已失效');
    return this.parse(value);
  }

  async save(batch: ImportBatch): Promise<void> {
    batch.updated_at = new Date().toISOString();
    await this.redis.set(this.key(batch.batch_id), JSON.stringify(batch), { EX: BATCH_TTL_SECONDS });
  }

  async remove(batchId: string): Promise<void> {
    await this.redis.del(this.key(batchId));
  }

  async enqueue(message: QueueMessage): Promise<void> {
    await this.redis.lPush(QUEUE_KEY, JSON.stringify(message));
  }

  async dequeue(): Promise<QueueMessage | null> {
    const value = await this.redis.rPopLPush(QUEUE_KEY, PROCESSING_QUEUE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<QueueMessage>;
    if (typeof candidate.batch_id !== 'string' || typeof candidate.item_id !== 'string') return null;
    return { batch_id: candidate.batch_id, item_id: candidate.item_id };
  }

  async acknowledge(message: QueueMessage): Promise<void> {
    await this.redis.lRem(PROCESSING_QUEUE_KEY, 1, JSON.stringify(message));
  }

  async retry(message: QueueMessage): Promise<void> {
    const value = JSON.stringify(message);
    await this.redis.lRem(PROCESSING_QUEUE_KEY, 1, value);
    await this.redis.rPush(QUEUE_KEY, value);
  }

  async recoverInterrupted(): Promise<void> {
    const values = await this.redis.lRange(PROCESSING_QUEUE_KEY, 0, -1);
    if (values.length === 0) return;
    await this.redis.del(PROCESSING_QUEUE_KEY);
    await this.redis.rPush(QUEUE_KEY, values);
  }

  progress(batch: ImportBatch): ImportProgress {
    const statuses: ItemStatus[] = ['queued', 'processing', 'awaiting_confirmation', 'completed', 'duplicate', 'failed'];
    const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<ItemStatus, number>;
    for (const item of batch.items) counts[item.status] += 1;
    return {
      batch_id: batch.batch_id,
      source: batch.source,
      status: batch.status,
      stage: batch.stage,
      counts: { total: batch.items.length, ...counts },
      items: batch.items.map(({ item_id, display_name, status, stage, failure, review, case_id }) => ({
        item_id,
        display_name,
        status,
        stage,
        failure,
        review,
        case_id,
      })),
    };
  }

  refreshStatus(batch: ImportBatch): void {
    const statuses = batch.items.map((item) => item.status);
    if (statuses.every((status) => status === 'completed' || status === 'duplicate')) {
      batch.status = 'completed';
      batch.stage = 'completed';
      return;
    }
    if (statuses.every((status) => status === 'failed')) {
      batch.status = 'failed';
      batch.stage = 'failed';
      return;
    }
    if (statuses.every((status) => ['completed', 'duplicate', 'failed'].includes(status))) {
      batch.status = 'completed_with_failures';
      batch.stage = 'completed';
      return;
    }
    if (statuses.some((status) => status === 'processing' || status === 'queued')) {
      batch.status = 'processing';
      batch.stage = batch.items.find((item) => item.status === 'processing')?.stage ?? 'queued';
      return;
    }
    batch.status = 'awaiting_confirmation';
    batch.stage = 'manual_confirmation';
  }

  private key(batchId: string): string {
    return `${BATCH_PREFIX}${batchId}`;
  }

  private parse(value: string): ImportBatch {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Partial<ImportBatch>).items)) {
      throw new Error('导入批次数据无效');
    }
    return parsed as ImportBatch;
  }
}
