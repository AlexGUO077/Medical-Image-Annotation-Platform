import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
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

@Injectable()
export class OrthancService {
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
