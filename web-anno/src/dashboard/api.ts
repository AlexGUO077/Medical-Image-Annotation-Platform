import { ViewerRequestError } from '../viewer/api';
import type { Metrics, StatsOptions, StatsQuery, StatsResult } from './types';
async function request(path:string,token:string,signal:AbortSignal) {
  const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new ViewerRequestError(response.status,'统计响应格式无效');
  const data=await response.json();
  if(!response.ok)throw new ViewerRequestError(response.status,typeof data.message==='string'?data.message:'统计请求失败');
  return data;
}
function validMetrics(data:Metrics):boolean {
  if(!data||!['completed','normal_passed','normal_returned','normal_total','spotcheck_passed','spotcheck_returned','spotcheck_total'].every(key=>Number.isSafeInteger(data[key as keyof Metrics])&&Number(data[key as keyof Metrics])>=0))return false;
  return data.completed<=data.normal_passed && data.normal_total===data.normal_passed+data.normal_returned
    && data.spotcheck_total===data.spotcheck_passed+data.spotcheck_returned
    && data.return_rate===(data.normal_total?data.normal_returned/data.normal_total:null)
    && data.spotcheck_pass_rate===(data.spotcheck_total?data.spotcheck_passed/data.spotcheck_total:null);
}
export const statsApi={
  async read(token:string,query:StatsQuery,signal:AbortSignal):Promise<StatsResult> {
    const params=new URLSearchParams();for(const [key,value]of Object.entries(query))if(value!==undefined&&value!=='')params.set(key,String(value));
    const data=await request(`/api/stats?${params}`,token,signal) as StatsResult;
    if(!data.filters||data.filters.timezone!=='Asia/Shanghai'||data.filters.group_by!==(query.group_by??'task')
      ||typeof data.filters.from!=='string'||typeof data.filters.to!=='string'
      ||!/^\d{4}-\d{2}-\d{2}$/.test(data.filters.from)||!/^\d{4}-\d{2}-\d{2}$/.test(data.filters.to)
      ||data.page!==(query.page??1)||data.pageSize!==(query.pageSize??20)||!Number.isSafeInteger(data.total)||data.total<0
      ||!validMetrics(data.summary)||!Array.isArray(data.items)||data.items.length>data.pageSize
      ||!data.items.every(item=>typeof item.key==='string'&&typeof item.label==='string'&&validMetrics(item))
      ||!Array.isArray(data.trend)||!data.trend.every(item=>typeof item.day==='string'&&validMetrics(item)))throw new ViewerRequestError(502,'统计指标响应无效');
    return data;
  },
  async options(kind:'task'|'person',token:string,page:number,signal:AbortSignal):Promise<StatsOptions> {
    const data=await request(`/api/${kind==='task'?'tasks':'users'}?page=${page}&pageSize=20`,token,signal);
    if(!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.page!==page)throw new ViewerRequestError(502,'统计筛选选项无效');
    return {page,total:data.total,items:data.items.map((item:{id:string;name?:string;real_name?:string;username?:string})=>({value:item.id,label:kind==='task'?item.name??'任务':`${item.real_name} (${item.username})`}))};
  },
};
