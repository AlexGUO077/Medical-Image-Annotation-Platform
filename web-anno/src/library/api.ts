import { ViewerRequestError } from '../viewer/api';
import type { LibraryData, SearchFilters, SearchResult } from './types';
async function request(path:string,token:string,signal:AbortSignal){
 const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store',redirect:'error'});
 if(!response.headers.get('content-type')?.includes('application/json'))throw new ViewerRequestError(response.status,'病例库响应格式无效');
 const data=await response.json();if(!response.ok)throw new ViewerRequestError(response.status,typeof data.message==='string'?data.message:'病例库请求失败');return data;
}
export const libraryApi={
 async search(token:string,filters:SearchFilters,signal:AbortSignal):Promise<SearchResult>{
  const params=new URLSearchParams();for(const [key,value]of Object.entries(filters))if(value!==undefined&&value!=='')params.set(key,String(value));
  const data=await request(`/api/search?${params}`,token,signal);
  if(!Array.isArray(data.items)||![data.page,data.pageSize,data.total].every(n=>Number.isSafeInteger(n)&&n>=0)||data.page<1||data.pageSize<1||data.pageSize>100||data.items.length>data.pageSize)throw new ViewerRequestError(502,'病例库分页响应无效');
  return data;
 },
 async read(id:string,token:string,signal:AbortSignal):Promise<LibraryData>{
  const data=await request(`/api/library/${encodeURIComponent(id)}`,token,signal);
  if(data.case?.id!==id||data.case?.source!=='synthetic'||data.case?.status!=='已发布'||!Number.isSafeInteger(data.version)||data.version<0||data.version!==data.current_version||!Array.isArray(data.series)||!Array.isArray(data.sentences)||!Array.isArray(data.attachments)||!Array.isArray(data.annotations))throw new ViewerRequestError(502,'已发布版本响应无效');return data;
 },
};
