import { annotationPayload, type Annotation, type AnnotationRead, type AnnotationVersion } from './types';
export class AnnotationRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
async function request<T>(id: string, token: string, signal: AbortSignal, body?: unknown, version?: number): Promise<T> {
  const response = await fetch(`/api/cases/${encodeURIComponent(id)}/annotations${version === undefined ? '' : `?version=${version}`}`, {
    method: body === undefined ? 'GET' : 'PUT', signal, cache:'no-store', redirect:'error',
    headers: { Authorization:`Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type':'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new AnnotationRequestError(response.status, '标注响应格式无效');
  const data = await response.json();
  if (!response.ok) throw new AnnotationRequestError(response.status, typeof data.message === 'string' ? data.message : '标注请求失败');
  return data as T;
}
export const annotationsApi = {
  read: (id:string, token:string, signal:AbortSignal, version?:number) => request<AnnotationRead>(id,token,signal,undefined,version),
  save: (id:string, token:string, signal:AbortSignal, version:number, annotations:readonly Annotation[]) => request<AnnotationVersion>(id,token,signal,{expected_version:version,annotations:annotationPayload(annotations)}),
};
