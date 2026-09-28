import type { ConfirmMethod, ImportSource, SystemCode } from './types';

export interface ManualDraft {
  draft_id: string;
  masked_report: string;
  masked_count: number;
  image_redaction_count: number;
  expires_at: string;
}

export interface ManualCaseCreated {
  case_id: string;
  case_no: string;
  status: '已录入';
}

async function jsonResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? '服务响应格式无效' : '服务暂时不可用，请稍后重试');
  }
  const value = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(value.message ?? fallback);
  return value;
}

export const casesManualApi = {
  async prepare(token: string, source: ImportSource, report: string, image: File): Promise<ManualDraft> {
    const body = new FormData();
    body.append('source', source);
    body.append('report_text', report);
    body.append('image', image, image.type === 'image/jpeg' ? 'key-image.jpg' : 'key-image.png');
    const response = await fetch('/api/cases/manual/prepare', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
    });
    const draft = await jsonResponse<ManualDraft>(response, '手工录入脱敏失败');
    if (!draft.draft_id || typeof draft.masked_report !== 'string' || !Number.isInteger(draft.masked_count) ||
        !Number.isInteger(draft.image_redaction_count)) throw new Error('服务响应格式无效');
    return draft;
  },

  async preview(token: string, draftId: string): Promise<Blob> {
    const response = await fetch(`/api/cases/manual/${encodeURIComponent(draftId)}/preview`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) {
      throw new Error('脱敏关键影像预览失败');
    }
    return response.blob();
  },

  async confirm(token: string, draftId: string, systemCode: SystemCode, confirmMethod: ConfirmMethod): Promise<ManualCaseCreated> {
    const response = await fetch(`/api/cases/manual/${encodeURIComponent(draftId)}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, system_code: systemCode, confirm_method: confirmMethod }),
    });
    const created = await jsonResponse<ManualCaseCreated>(response, '手工病例确认失败');
    if (!created.case_id || !created.case_no || created.status !== '已录入') throw new Error('服务响应格式无效');
    return created;
  },
};
