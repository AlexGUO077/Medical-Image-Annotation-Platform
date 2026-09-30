export interface FrameWindow { center: number; width: number }
export interface Series { id: string; series_uid: string; modality: string; frame_count: number; default_window: FrameWindow | null }
export interface Workbench {
  case: { id: string; case_no: string; source: string; system_code: string; status: string; clinical_text: string | null; age_band: string | null; sex: string | null; confirm_method: string };
  series: Series[]; sentences: { idx: number; text: string }[]; attachments: { id: string; filename: string; kind: string }[];
}
async function json<T>(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type':'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务响应格式无效');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? '工作台请求失败');
  return data as T;
}
export const viewerApi = {
  workbench: (id: string, token: string, signal: AbortSignal) => json<Workbench>(`/api/workbench/${encodeURIComponent(id)}`, token, signal),
  async frame(token: string, caseId: string, series: Series, index: number, window: FrameWindow | null, signal: AbortSignal): Promise<Blob> {
    const ticket = await json<{ url: string }>('/api/frames/ticket', token, signal, { case_id: caseId, series_uid: series.series_uid, frame_index: index, window });
    if (!/^\/api\/frames\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket.url)) throw new Error('帧地址无效');
    const response = await fetch(ticket.url, { headers: { Authorization: `Bearer ${token}` }, signal, cache:'no-store', redirect:'error' });
    if (!response.ok) {
      const error = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      throw new Error(error.message ?? '帧加载失败');
    }
    if (response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('帧格式无效');
    return response.blob();
  },
};
