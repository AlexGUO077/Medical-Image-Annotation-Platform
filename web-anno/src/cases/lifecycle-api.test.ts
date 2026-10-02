import {afterEach,expect,it,vi} from 'vitest';
import {casesLifecycleApi,LifecycleRequestError} from './lifecycle-api';
afterEach(()=>vi.unstubAllGlobals());
it('sends only the expected version and requires the agreed transition response',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({case_id:'case',status:'待分配',version:4}),{status:201,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
  const signal=new AbortController().signal;
  expect(await casesLifecycleApi.change('token','case',3,'reactivate',signal)).toEqual({case_id:'case',status:'待分配',version:4});
  expect(fetcher).toHaveBeenCalledWith('/api/cases/case/reactivate',expect.objectContaining({signal,cache:'no-store',redirect:'error',body:JSON.stringify({expected_version:3}),headers:{Authorization:'Bearer token','Content-Type':'application/json'}}));
});
it('rejects state/version/case mismatches and preserves server conflicts',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  for(const value of [{case_id:'other',status:'已下线',version:3},{case_id:'case',status:'已发布',version:3},{case_id:'case',status:'已下线',version:4}]){
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(value),{status:201,headers:{'Content-Type':'application/json'}}));
    await expect(casesLifecycleApi.change('token','case',3,'offline',new AbortController().signal)).rejects.toMatchObject({status:502});
  }
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({message:'原任务不可用'}),{status:409,headers:{'Content-Type':'application/json'}}));
  await expect(casesLifecycleApi.change('token','case',3,'reactivate',new AbortController().signal)).rejects.toEqual(new LifecycleRequestError(409,'原任务不可用'));
});
