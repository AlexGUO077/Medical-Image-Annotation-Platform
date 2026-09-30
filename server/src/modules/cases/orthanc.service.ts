import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { frameGeometry } from './frame-geometry';
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

  // Resolve a flattened series frame only from the authorized database mapping.
  // Never follow URLs returned by Orthanc; parse and rebuild a fixed rendered endpoint.
  async resolveSeriesFrame(seriesId: string, seriesUid: string, index: number, frameCount: number) {
    const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/;
    if (!idPattern.test(seriesId) || !Number.isSafeInteger(index) || index < 0 || index >= frameCount) {
      throw new BadRequestException('序列帧索引无效');
    }
    try {
      const series = await (await this.request(`/series/${seriesId}`, { method: 'GET', redirect: 'error' })).json() as {
        MainDicomTags?: { SeriesInstanceUID?: string }; Instances?: string[];
      };
      if (series.MainDicomTags?.SeriesInstanceUID !== seriesUid || !Array.isArray(series.Instances)) throw new Error('Series mismatch');
      const ordered = await (await this.request(`/series/${seriesId}/ordered-slices`, { method: 'GET', redirect: 'error' })).json() as { Slices?: string[] };
      if (!Array.isArray(ordered.Slices) || ordered.Slices.length !== frameCount) throw new Error('Frame count mismatch');
      const slice = ordered.Slices[index];
      const match = typeof slice === 'string' ? /^\/instances\/([0-9a-f]{8}(?:-[0-9a-f]{8}){4})\/frames\/(0|[1-9][0-9]*)$/.exec(slice) : null;
      if (!match || !series.Instances.includes(match[1]!)) throw new Error('Frame ownership mismatch');
      const frame = Number(match[2]);
      if (!Number.isSafeInteger(frame)) throw new Error('Invalid frame');
      return { instance_id: match[1]!, frame_index: frame };
    } catch { throw new ServiceUnavailableException('序列帧映射不可用'); }
  }

  async frameGeometry(instanceId: string, frameIndex: number) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/.test(instanceId) || !Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new BadRequestException('帧几何参数无效');
    try {
      const tags = await (await this.request(`/instances/${instanceId}/simplified-tags`, { method:'GET', redirect:'error' })).json() as Record<string,unknown>;
      return frameGeometry(tags, frameIndex);
    } catch { throw new ServiceUnavailableException('帧几何信息不可用'); }
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
