import { afterEach, expect, it, vi } from 'vitest';
import { annotationsApi } from './api';
import { annotationPayload, type Annotation } from './types';
const item:Annotation={id:'id',series_id:'series',tool:'point',geometry:{x:1,y:2},frame_start:0,frame_end:0,key_frame_index:0,window_preset:null,part_id:'part',sign_tag_ids:['sign'],confidence:'typical',report_sent_ids:[-1]};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
afterEach(()=>vi.restoreAllMocks());
it('sends the version and stable IDs, excludes read metadata, and disables cache/redirects',async()=>{
 const signal=new AbortController().signal;const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({version:2,annotations:[item]}));
 const decorated={...item,is_gold:false,version:1,token:'never-persist',geometry:{x:1,y:2,report_text:'never-persist'}};
 await annotationsApi.save('case/a','token',signal,1,[decorated]);
 expect(fetcher).toHaveBeenCalledWith('/api/cases/case%2Fa/annotations',expect.objectContaining({method:'PUT',signal,cache:'no-store',redirect:'error',body:JSON.stringify({expected_version:1,annotations:[item]})}));
 expect(annotationPayload([decorated])).toEqual([item]);
});
it('uses a separate optional history version and preserves permission/conflict status codes',async()=>{
 const signal=new AbortController().signal;const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({version:1,current_version:3,annotations:[]})).mockResolvedValueOnce(json({message:'冲突'},409)).mockResolvedValueOnce(new Response('denied',{status:403}));
 await annotationsApi.read('case','token',signal,1);expect(fetcher.mock.calls[0][0]).toBe('/api/cases/case/annotations?version=1');
 await expect(annotationsApi.save('case','token',signal,1,[])).rejects.toMatchObject({status:409});await expect(annotationsApi.read('case','token',signal)).rejects.toMatchObject({status:403});
});
