import type {Assignee} from '../tasks/api';
import type {Qualifications} from '../auth/types';
import {ViewerRequestError} from '../viewer/api';
export interface Version {id:string;version:number}
export interface ExportRow {id:string;requester_id:string;approver_id:string|null;status:string;case_versions:Version[];created_at:string;expire_at:string|null;download_count:number;url:string|null}
export interface AuditRow {id:string;actor:string|null;action:string;target:string;detail:Record<string,unknown>;ip:string;created_at:string}
export interface Page<T>{items:T[];page:number;pageSize:number;total:number}
export interface Candidate extends Version{source:string;system_code:string}
export interface CreateAccount {real_name:string;email?:string;phone?:string;role:'admin'|'member';quals:Qualifications;expire_at:string}
export interface InitialAccount {id:string;username:string;initial_password:string;must_change_password:true}
export interface AccountUpdate {id:string;status?:'active'|'disabled';expire_at?:string;quals?:Qualifications;reset_mfa?:true}
async function request<T>(token:string,path:string,body?:unknown,signal?:AbortSignal,method=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch('/api'+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error',signal});
 if(!response.headers.get('content-type')?.includes('application/json'))throw new ViewerRequestError(response.status,'服务响应格式无效');
 const data=await response.json();if(!response.ok)throw new ViewerRequestError(response.status,data.message??'管理请求失败');return data as T;
}
export const adminApi={
 users:(token:string,page:number,signal?:AbortSignal)=>request<Page<Assignee>>(token,`/users?page=${page}&pageSize=20`,undefined,signal),
 createUser:(token:string,input:CreateAccount)=>request<InitialAccount>(token,'/users',input),
 updateUser:(token:string,input:AccountUpdate)=>request<{id:string;updated:true;released_assignments:number}>(token,'/users',input,undefined,'PATCH'),
 enable:(token:string,id:string)=>request(token,'/users',{id,status:'active'},undefined,'PATCH'),
 exports:(token:string,page:number,signal?:AbortSignal)=>request<Page<ExportRow>>(token,`/exports?page=${page}&pageSize=20`,undefined,signal),
 candidates:(token:string,page:number,signal?:AbortSignal)=>request<Page<Candidate>>(token,`/exports/candidates?page=${page}&pageSize=20`,undefined,signal),
 create:(token:string,case_ids:string[])=>request(token,'/exports',{case_ids}),
 decide:(token:string,id:string,decision:'approve'|'reject')=>request(token,`/exports/${encodeURIComponent(id)}/approve`,{decision}),
 audit:(token:string,page:number,filters:Record<string,string>,signal?:AbortSignal)=>request<Page<AuditRow>>(token,`/audit?${new URLSearchParams({page:String(page),pageSize:'20',...Object.fromEntries(Object.entries(filters).filter(([,v])=>v))})}`,undefined,signal),
 async download(token:string,id:string){
  const response=await fetch(`/api/exports/${encodeURIComponent(id)}/download`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error'});
  if(!response.ok){const data=await response.json();throw new ViewerRequestError(response.status,data.message??'领取失败');}
  if(!response.headers.get('content-type')?.includes('application/json')||!response.headers.get('content-disposition')?.startsWith('attachment;'))throw new Error('领取响应无效');
  const blob=await response.blob();if(blob.size>5*1024*1024)throw new Error('领取响应过大');return blob;
 },
};
export function saveExport(blob:Blob,id:string){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`synthetic-export-${id}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
