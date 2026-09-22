import type {
  ConfirmImportInput,
  ConfirmImportResponse,
  ImportAccepted,
  ImportProgress,
  ImportSource,
} from './types';

async function jsonResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? '服务响应格式无效' : '服务暂时不可用，请稍后重试');
  }
  const payload = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? fallback);
  return payload;
}

export const casesImportApi = {
  async create(token: string, source: ImportSource, file: File) {
    const body = new FormData();
    body.append('source', source);
    body.append('file', file, 'import.zip');
    const response = await fetch('/api/cases/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    return jsonResponse<ImportAccepted>(response, '导入批次创建失败');
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
