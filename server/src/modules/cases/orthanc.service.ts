import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { requiredEnv } from '../../config/environment';

interface OrthancUploadResponse {
  ParentSeries?: string;
  ID?: string;
  Status?: string;
}

export interface OrthancSeriesUpload {
  id: string;
  created: boolean;
}

export interface FrameWindow {
  center: number;
  width: number;
}

@Injectable()
export class OrthancService {
  // Internal rendering only: callers must resolve this instance from an authorized
  // case/series, and apply ticket checks, watermarking and audit before any output.
  async renderInstanceFrame(instanceId: string, frameIndex: number, window?: FrameWindow): Promise<Buffer> {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/.test(instanceId) ||
        !Number.isSafeInteger(frameIndex) || frameIndex < 0 ||
        (window !== undefined && (!window || !Number.isFinite(window.center) || !Number.isFinite(window.width) || window.width <= 0))) {
      throw new BadRequestException('帧渲染参数无效');
    }
    const query = window ? `?${new URLSearchParams({
      'window-center': String(window.center), 'window-width': String(window.width),
    })}` : '';
    try {
      const response = await this.request(`/instances/${instanceId}/frames/${frameIndex}/rendered${query}`, {
        method: 'GET', headers: { accept: 'image/png' }, redirect: 'error',
      });
      if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'image/png') throw new Error('Unexpected render format');
      const image = sharp(Buffer.from(await response.arrayBuffer()), { limitInputPixels: 50_000_000 });
      const metadata = await image.metadata();
      if (metadata.format !== 'png') throw new Error('Unexpected render bytes');
      // Re-encoding strips optional embedded metadata; never fall back to raw DICOM
      // or image-uint16/image-int16 endpoints when rendering fails.
      return await image.png().toBuffer();
    } catch {
      throw new ServiceUnavailableException('单帧渲染不可用');
    }
  }

  async uploadSeries(paths: string[]): Promise<OrthancSeriesUpload> {
    let seriesId: string | undefined;
    let created = false;
    try {
      for (const path of paths) {
        const response = await this.request('/instances', {
          method: 'POST',
          headers: { 'content-type': 'application/dicom' },
          body: await readFile(path),
        });
        const result = await response.json() as OrthancUploadResponse;
        if (!result.ParentSeries) throw new ServiceUnavailableException('Orthanc 未返回序列标识');
        if (seriesId && seriesId !== result.ParentSeries) throw new ServiceUnavailableException('Orthanc 序列分组不一致');
        seriesId = result.ParentSeries;
        created ||= result.Status !== 'AlreadyStored';
      }
    } catch (error) {
      if (seriesId && created) await this.removeSeries([seriesId]);
      throw error;
    }
    if (!seriesId) throw new ServiceUnavailableException('没有可写入 Orthanc 的 DICOM');
    return { id: seriesId, created };
  }

  async removeSeries(seriesIds: string[]): Promise<void> {
    await Promise.allSettled(seriesIds.map(async (id) => {
      await this.request(`/series/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }));
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const protocol = process.env.ORTHANC_USE_TLS === 'true' ? 'https' : 'http';
    const host = process.env.ORTHANC_HOST ?? '127.0.0.1';
    const port = process.env.ORTHANC_PORT ?? '8042';
    const auth = Buffer.from(`${requiredEnv('ORTHANC_USERNAME')}:${requiredEnv('ORTHANC_PASSWORD')}`).toString('base64');
    try {
      const response = await fetch(`${protocol}://${host}:${port}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return response;
    } catch {
      throw new ServiceUnavailableException('Orthanc 不可用');
    }
  }
}
