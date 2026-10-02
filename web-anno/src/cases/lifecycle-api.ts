export class LifecycleRequestError extends Error {
  constructor(public readonly status:number,message:string){super(message);}
}
export interface LifecycleResult {case_id:string;status:'已下线'|'待分配';version:number}
export const casesLifecycleApi={
  async change(token:string,id:string,version:number,action:'offline'|'reactivate',signal:AbortSignal):Promise<LifecycleResult>{
    const response=await fetch(`/api/cases/${encodeURIComponent(id)}/${action}`,{method:'POST',signal,cache:'no-store',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({expected_version:version})});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new LifecycleRequestError(response.status,'病例操作响应格式无效，请重新读取病例');
    const value=await response.json();
    if(!response.ok)throw new LifecycleRequestError(response.status,typeof value.message==='string'?value.message:'病例操作失败');
    if(value.case_id!==id||value.status!==(action==='offline'?'已下线':'待分配')||value.version!==(action==='offline'?version:version+1))
      throw new LifecycleRequestError(502,'病例操作响应无效，请重新读取病例核对');
    return value;
  },
};
