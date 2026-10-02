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
  if(!Number.isInteger(data.version)||data.version<0||!Array.isArray(data.annotations))throw new AnnotationRequestError(502,'标注响应结构无效');
  return data as T;
}
export const annotationsApi = {
  read: (id:string, token:string, signal:AbortSignal, version?:number) => request<AnnotationRead>(id,token,signal,undefined,version),
  async save(id:string,token:string,signal:AbortSignal,version:number,annotations:readonly Annotation[]) {
    const result=await request<AnnotationVersion>(id,token,signal,{expected_version:version,annotations:annotationPayload(annotations)});
    if(result.version!==version+1||result.annotations.length!==annotations.length||new Set(result.annotations.map(a=>a.id)).size!==annotations.length||annotations.some(a=>!result.annotations.some(saved=>saved.id===a.id)))throw new AnnotationRequestError(502,'保存响应对象或版本不一致，请重新检查');
    return result;
  },
};
