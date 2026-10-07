import {afterEach,expect,it,vi} from 'vitest';
import {statsResult} from '../../../test/fixtures/synthetic/stats';
import {statsApi} from './api';
afterEach(()=>vi.unstubAllGlobals());
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
it('uses authenticated no-store GET and preserves full summary with paged groups',async()=>{
 const fetcher=vi.fn().mockResolvedValue(reply(statsResult));vi.stubGlobal('fetch',fetcher);
 expect(await statsApi.read('synthetic',{task_id:'task',from:'2026-10-01',to:'2026-10-02'},new AbortController().signal)).toEqual(statsResult);
 expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('task_id=task'),expect.objectContaining({cache:'no-store',redirect:'error',headers:{Authorization:'Bearer synthetic'}}));
});
it.each([{summary:{...statsResult.summary,return_rate:33.3}},{summary:{...statsResult.summary,spotcheck_total:0}},
 {page:2},{items:[{...statsResult.items[0],completed:-1}]},{trend:[{...statsResult.trend[0],normal_total:0}]}])('rejects inconsistent metric response %j',async change=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({...statsResult,...change})));
 await expect(statsApi.read('token',{},new AbortController().signal)).rejects.toThrow('统计指标响应无效');
});
it('preserves rejection status and message for expired authorization',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({message:'账号已停用'},403)));
 await expect(statsApi.read('token',{},new AbortController().signal)).rejects.toMatchObject({status:403,message:'账号已停用'});
});
