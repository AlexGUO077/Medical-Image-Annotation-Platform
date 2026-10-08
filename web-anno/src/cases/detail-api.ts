export interface CaseAttachment {
  id: string;
  kind: string;
  filename: string;
  size: string;
  deid_confirmed: boolean;
}

export interface CaseDetail {
  id: string;
  case_no: string;
  status: string;
  annotation_version: number;
  source: string;
  system_code: string;
  confirm_method: string;
  disease_tag_id?: string | null;
  disease_tag_name?: string | null;
  clinical_text: string | null;
  age_band: string | null;
  sex: string | null;
  teaching_fields: Record<string, unknown> | null;
  attachments: CaseAttachment[];
}

export interface CaseReport {
  masked_report: string;
  sentences: Array<{ idx: number; text: string }>;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('病例读取失败');
  const value = await response.json() as { message?: string } & T;
  if (!response.ok) throw new Error(value.message ?? '病例读取失败');
  return value;
}

export const casesDetailApi = {
  async detail(token: string, id: string): Promise<CaseDetail> {
    const response = await fetch(`/api/cases/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    return jsonResponse<CaseDetail>(response);
  },
  async report(token: string, id: string): Promise<CaseReport> {
    const response = await fetch(`/api/cases/${encodeURIComponent(id)}/report`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (response.status === 404) return { masked_report: '', sentences: [] };
    return jsonResponse<CaseReport>(response);
  },
  async preview(token: string, caseId: string, attachmentId: string): Promise<Blob> {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/preview?page=1`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) throw new Error('附件预览失败');
    return response.blob();
  },
};

export interface ClinicalInput { disease_tag_id?: string; clinical_text: string; age_band: string; sex: string; confirm_method: string }
export interface TeachingInput { difficulty: string; applicable_level: string; sign_points: string[] }
export interface AttachmentProgress {
  status: 'receiving' | 'processing' | 'pending_confirmation' | 'failed';
  next_part_index: number; part_count: number; page_count: number; failure_code: string | null;
}
const root = (id: string) => `/api/cases/${encodeURIComponent(id)}`;
async function write<T>(token: string, url: string, method: string, body: unknown): Promise<T> {
  return jsonResponse<T>(await fetch(url, { method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, cache: 'no-store', body: JSON.stringify(body) }));
}
export const caseEditApi = {
  clinical: (token: string, id: string, body: ClinicalInput) => write<ClinicalInput & { masked_count: number }>(token, `${root(id)}/clinical`, 'PUT', body),
  teaching: (token: string, id: string, body: TeachingInput) => write<TeachingInput & { masked_count: number }>(token, `${root(id)}/teaching`, 'PATCH', body),
  async upload(token: string, id: string, file: File, progress: (received: number) => void, signal?: AbortSignal): Promise<string> {
    const format = file.name.split('.').pop()?.toLowerCase().replace('jpeg', 'jpg') ?? '';
    const mime: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    if (!Object.hasOwn(mime, format) || file.size < 1 || file.size > 50 * 1024 * 1024 || (file.type && file.type !== mime[format])) {
      throw new Error('附件须为 PDF/JPG/PNG/DOCX/XLSX，单文件不超过 50 MB');
    }
    const chunkSize = 5 * 1024 * 1024, count = Math.ceil(file.size / chunkSize);
    let uploadId = '';
    for (let part = 0; part < count; part++) {
      const form = new FormData();
      form.set('part_index', String(part)); form.set('part_count', String(count));
      form.set('file_size', String(file.size)); form.set('format', format);
      if (uploadId) form.set('upload_id', uploadId);
      form.set('chunk', file.slice(part * chunkSize, (part + 1) * chunkSize, mime[format]), `chunk.${format}`);
      const result = await jsonResponse<{ upload_id: string; next_part_index: number }>(await fetch(`${root(id)}/attachments`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, cache: 'no-store', signal,
      }));
      if (result.next_part_index !== part + 1 || !result.upload_id || (uploadId && result.upload_id !== uploadId)) throw new Error('上传会话响应无效');
      uploadId = result.upload_id;
      progress(Math.min(file.size, (part + 1) * chunkSize));
    }
    return uploadId;
  },
  async progress(token: string, id: string, upload: string): Promise<AttachmentProgress> {
    return jsonResponse(await fetch(`${root(id)}/attachments/uploads/${encodeURIComponent(upload)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    }));
  },
  confirm: (token: string, id: string, upload: string, kind: string) => write(token, `${root(id)}/attachments/uploads/${encodeURIComponent(upload)}/confirm`, 'POST', { confirmed: true, kind }),
  async preview(token: string, id: string, target: string, page: number, pending: boolean): Promise<{ blob: Blob; page_count: number }> {
    const response = await fetch(`${root(id)}/attachments/${pending ? 'uploads/' : ''}${encodeURIComponent(target)}/preview?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) throw new Error('安全预览暂不可用');
    return { blob: await response.blob(), page_count: Number(response.headers.get('X-Preview-Page-Count') ?? 1) };
  },
};
