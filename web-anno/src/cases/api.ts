import type {
  ConfirmImportInput,
  ConfirmImportResponse,
  ImportAccepted,
  ImportProgress,
  ImportSource,
} from './types';

export interface UploadProgress {
  loaded: number;
  total: number;
}

async function jsonResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? '服务响应格式无效' : '服务暂时不可用，请稍后重试');
  }
  const payload = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? fallback);
  return payload;
}

export const casesImportApi = {
  async create(token: string, source: ImportSource, file: File, onProgress?: (progress: UploadProgress) => void) {
    const body = new FormData();
    body.append('source', source);
    body.append('file', file, 'import.zip');
    return new Promise<ImportAccepted>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/cases/import');
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.({ loaded: event.loaded, total: event.total });
        }
      };
      request.onerror = () => reject(new Error('上传连接中断，无法确认批次是否已接收'));
      request.onabort = () => reject(new Error('上传已中断'));
      request.onload = () => {
        if (!request.getResponseHeader('content-type')?.includes('application/json')) {
          reject(new Error(request.status >= 200 && request.status < 300
            ? '服务响应格式无效' : '服务暂时不可用，请稍后重试'));
          return;
        }
        try {
          const payload = JSON.parse(request.responseText) as { message?: string } & ImportAccepted;
          if (request.status < 200 || request.status >= 300) {
            reject(new Error(payload.message ?? '导入批次创建失败'));
            return;
          }
          if (typeof payload.batch_id !== 'string' || payload.status !== 'queued' ||
              !['synthetic', 'teacher_provided_teaching'].includes(payload.source)) {
            reject(new Error('服务响应格式无效'));
            return;
          }
          resolve(payload);
        } catch {
          reject(new Error('服务响应格式无效'));
        }
      };
      request.send(body);
    });
  },

  async progress(token: string, batchId: string) {
    const response = await fetch(`/api/cases/import/${encodeURIComponent(batchId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return jsonResponse<ImportProgress>(response, '导入进度读取失败');
  },

  async preview(token: string, batchId: string, itemId: string) {
    const response = await fetch(
      `/api/cases/import/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/preview`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) {
      throw new Error('脱敏预览加载失败');
    }
    return response.blob();
  },

  async confirm(token: string, batchId: string, itemId: string, input: ConfirmImportInput) {
    const response = await fetch(
      `/api/cases/import/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    );
    return jsonResponse<ConfirmImportResponse>(response, '脱敏确认失败');
  },
};
