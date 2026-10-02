import { afterEach,expect,it,vi } from 'vitest';
import { reviewsApi } from './api';
const checks={kind:'checks' as const,deidentification:true,confirmation_basis:true,disease_label:true};
afterEach(()=>vi.unstubAllGlobals());
it('posts only the approved review payload and validates the published result',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({review_id:'review',case_id:'case',version:3,status:'已发布',is_gold:true,reannotation:null}),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 expect((await reviewsApi.decide('case','bearer',new AbortController().signal,3,'通过',[checks])).status).toBe('已发布');
 const [path,options]=fetch.mock.calls[0];expect(path).toBe('/api/reviews/case');expect(options.cache).toBe('no-store');expect(options.redirect).toBe('error');expect(JSON.parse(options.body)).toEqual({expected_version:3,result:'通过',comments:[checks]});
});
it('preserves server failures and rejects a mismatched version instead of reporting success',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'审核分派已失效'}),{status:403,headers:{'Content-Type':'application/json'}})));
 await expect(reviewsApi.read('case','bearer',new AbortController().signal)).rejects.toMatchObject({status:403});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({review_id:'r',case_id:'case',version:4,status:'已发布',is_gold:true,reannotation:null}),{headers:{'Content-Type':'application/json'}})));
 await expect(reviewsApi.decide('case','bearer',new AbortController().signal,3,'通过',[checks])).rejects.toMatchObject({status:502});
});
