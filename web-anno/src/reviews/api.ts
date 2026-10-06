import { ViewerRequestError } from '../viewer/api';
import type { ReviewComment,ReviewData,ReviewResult } from './types';
async function request(id:string,token:string,signal:AbortSignal,body?:unknown,version?:number){
  const response=await fetch(`/api/reviews/${encodeURIComponent(id)}${version===undefined?'':`?version=${version}`}`,{method:body===undefined?'GET':'POST',signal,cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new ViewerRequestError(response.status,'审核响应格式无效');
  const data=await response.json();
  if(!response.ok)throw new ViewerRequestError(response.status,typeof data.message==='string'?data.message:'审核请求失败');
  return data;
}
export const reviewsApi={
  async read(id:string,token:string,signal:AbortSignal,version?:number):Promise<ReviewData>{
    const data=await request(id,token,signal,undefined,version);
    const quality=['spotcheck','recheck'].includes(data.review_kind);
    if(data.case?.id!==id||(quality?(data.case?.status!=='已发布'||typeof data.assignment_id!=='string'||!data.started_at||data.review_version!==data.current_version):data.case?.status!=='审核中')||!Number.isInteger(data.version)||!Number.isInteger(data.current_version)||data.version>data.current_version||!Array.isArray(data.annotations)||!Array.isArray(data.series)||!Array.isArray(data.sentences)||!['self','peer'].includes(data.review_mode))throw new ViewerRequestError(502,'审核响应结构无效');
    return data;
  },
  async decide(id:string,token:string,signal:AbortSignal,version:number,result:'通过'|'打回',comments:ReviewComment[],assignmentId?:string):Promise<ReviewResult>{
    const data=await request(id,token,signal,{expected_version:version,result,comments,...(assignmentId?{assignment_id:assignmentId}:{})});
    if(data.case_id!==id||data.version!==version||typeof data.review_id!=='string'||
      (assignmentId?(!['spotcheck','recheck'].includes(data.review_kind)||data.status!==(result==='通过'?'已发布':'已下线')||data.is_gold!==true||data.reannotation!==null||![data.assigned_count,data.pending_count].every(n=>Number.isInteger(n)&&n>=0)):result==='通过'?(data.status!=='已发布'||data.is_gold!==true||data.reannotation!==null):(!['标注中','待分配'].includes(data.status)||data.is_gold!==false||!data.reannotation)))throw new ViewerRequestError(502,'审核响应无效，请返回任务列表核对');
    return data;
  },
};
