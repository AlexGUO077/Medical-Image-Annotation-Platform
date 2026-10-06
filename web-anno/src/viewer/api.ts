export interface FrameGeometry { width:number; height:number; row_spacing:number|null; column_spacing:number|null }
export interface FrameWindow { center: number; width: number }
export interface Series { id: string; series_uid: string; modality: string; frame_count: number; default_window: FrameWindow | null }
export interface Workbench {
  case: { id: string; case_no: string; source: string; system_code: string; status: string; clinical_text: string | null; age_band: string | null; sex: string | null; confirm_method: string };
  series: Series[]; sentences: { idx: number; text: string }[]; attachments: { id: string; filename: string; kind: string }[];
}
export class ViewerRequestError extends Error {constructor(public readonly status:number,message:string){super(message);}}
async function json<T>(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type':'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new ViewerRequestError(response.status,'服务响应格式无效');
  const data = await response.json();
  if (!response.ok) throw new ViewerRequestError(response.status,data.message ?? '工作台请求失败');
  return data as T;
}
async function readFrame(token: string, caseId: string, series: Series, index: number, window: FrameWindow | null, signal: AbortSignal,libraryVersion?:number): Promise<{blob:Blob;geometry:FrameGeometry}> {
    const ticket = await json<{ url: string }>('/api/frames/ticket', token, signal, { case_id: caseId, series_uid: series.series_uid, frame_index: index, window,...binding(libraryVersion) });
    if (!/^\/api\/frames\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket.url)) throw new Error('帧地址无效');
    const response = await fetch(ticket.url, { headers: { Authorization: `Bearer ${token}` }, signal, cache:'no-store', redirect:'error' });
    if (!response.ok) {
      const error = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      throw new ViewerRequestError(response.status,error.message ?? '帧加载失败');
    }
    if (response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('帧格式无效');
    let geometry: FrameGeometry;
    try { geometry = JSON.parse(response.headers.get('X-Frame-Geometry') ?? 'null'); } catch { throw new Error('帧坐标信息无效'); }
    if (!geometry || !Number.isInteger(geometry.width) || !Number.isInteger(geometry.height) || geometry.width<=0 || geometry.height<=0 ||
        ![geometry.row_spacing,geometry.column_spacing].every(v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>0))) throw new Error('帧坐标信息无效');
    return {blob:await response.blob(),geometry};
}
interface Preload {token:string;caseId:string;key:string;controller:AbortController;result:Promise<{blob:Blob;geometry:FrameGeometry}|undefined>}
const preloads=new Map<string,Preload>();
const binding=(version?:number)=>version===undefined?{}:{access_mode:'library',expected_version:version};
const keyFor=(token:string,caseId:string,series:Series,index:number,window:FrameWindow|null,version?:number)=>JSON.stringify([token,caseId,series.id,index,window,...(version===undefined?[]:[version])]);
export const viewerApi = {
 async attachment(token:string,caseId:string,id:string,page:number,signal:AbortSignal,context:'workbench'|'reviews'|'library'='workbench',version?:number){
  if(context==='library'&&!Number.isSafeInteger(version))throw new ViewerRequestError(400,'附件发布版本无效');
  const response=await fetch(`/api/${context}/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(id)}/preview?page=${page}${context==='library'?`&version=${version}`:''}`,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store',redirect:'error'});
  if(!response.ok){const data=response.headers.get('content-type')?.includes('application/json')?await response.json():{};throw new ViewerRequestError(response.status,data.message??'附件预览不可用');}
  const count=Number(response.headers.get('X-Page-Count'));
  if(response.headers.get('content-type')?.split(';')[0]!=='image/png'||!Number.isInteger(count)||count<1||count>100)throw new ViewerRequestError(502,'附件预览格式无效');
  return {blob:await response.blob(),page_count:count};
 },
 workbench:(id:string,token:string,signal:AbortSignal)=>json<Workbench>(`/api/workbench/${encodeURIComponent(id)}`,token,signal),
 async frame(token:string,caseId:string,series:Series,index:number,window:FrameWindow|null,signal:AbortSignal,libraryVersion?:number){
  const key=keyFor(token,caseId,series,index,window,libraryVersion),cached=preloads.get(key);preloads.delete(key);
  if(cached){
   const cancel=()=>cached.controller.abort();signal.addEventListener('abort',cancel,{once:true});
   try {
    // A prefetched, watermarked PNG grants no continuing authority. Recheck the live
    // account/assignment/rate gate before consuming it, including after an offline period.
    const ticket=await json<{url:string}>('/api/frames/ticket',token,signal,{case_id:caseId,series_uid:series.series_uid,frame_index:index,window,...binding(libraryVersion)});
    if(!/^\/api\/frames\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket.url))throw new Error('帧地址无效');
    const result=await cached.result;if(signal.aborted)throw new DOMException('Aborted','AbortError');if(result)return result;
   }catch(error){cached.controller.abort();throw error;}finally{signal.removeEventListener('abort',cancel);}
  }
  return readFrame(token,caseId,series,index,window,signal,libraryVersion);
 },
 preload(token:string,caseId:string,series:Series,index:number,window:FrameWindow|null,libraryVersion?:number){
  if(index<0||index>=series.frame_count)return;
  const key=keyFor(token,caseId,series,index,window,libraryVersion);if(preloads.has(key))return;
  // One-frame lookahead, bounded across this page; only watermarked display PNGs in RAM.
  for(const [old,item] of preloads){item.controller.abort();preloads.delete(old);}
  const controller=new AbortController();
  const result=readFrame(token,caseId,series,index,window,controller.signal,libraryVersion).catch(()=>undefined);
  preloads.set(key,{token,caseId,key,controller,result});
 },
 clearPreloads(token:string,caseId:string){for(const [key,item] of preloads)if(item.token===token&&item.caseId===caseId){item.controller.abort();preloads.delete(key);}},
};
