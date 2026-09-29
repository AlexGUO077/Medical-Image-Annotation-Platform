import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RESP_TYPES, type RedisClientType } from 'redis';
import sharp from 'sharp';
import { OrthancService, type FrameWindow } from '../cases/orthanc.service';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface FrameRenderSource {
  case_id: string;
  series_uid: string;
  instance_id: string;
  frame_index: number;
  window: FrameWindow | null;
}

// Internal pre-watermark cache. The caller must resolve the source from an
// authorized case/series and apply a user watermark and audit on EVERY response.
@Injectable()
export class FrameRenderCacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly orthanc: OrthancService,
  ) {}

  async render(source: FrameRenderSource): Promise<Buffer> {
    const hash = createHash('sha256').update(JSON.stringify([
      source.case_id, source.series_uid, source.instance_id, source.frame_index,
      source.window === null ? null : [source.window.center, source.window.width],
    ])).digest('hex');
    const key = `frames:render:v1:${hash}`;
    try {
      const cached = await this.redis.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }).get(key);
      if (cached !== null) {
        try { return await this.png(cached); } catch { /* Replace corrupt cache from Orthanc below. */ }
      }
      const rendered = await this.png(await this.orthanc.renderInstanceFrame(
        source.instance_id, source.frame_index, source.window ?? undefined,
      ));
      // Fixed lifetime from insertion, not sliding expiration on cache reads.
      await this.redis.set(key, rendered, { EX: 30 * 60 });
      return rendered;
    } catch {
      throw new ServiceUnavailableException('帧渲染缓存不可用');
    }
  }

  private async png(bytes: Buffer): Promise<Buffer> {
    const image = sharp(bytes, { limitInputPixels: 50_000_000 });
    if ((await image.metadata()).format !== 'png') throw new Error('Expected rendered PNG');
    return image.png().toBuffer();
  }
}
