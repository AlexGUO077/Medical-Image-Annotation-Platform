import { afterEach, expect, it, vi } from 'vitest';
import { viewerApi } from './api';
const series = { id: 's', series_uid: '2.25.1', modality: 'CT', frame_count: 300, default_window: null };
const signal = new AbortController().signal;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => {viewerApi.clearPreloads('token','case');vi.restoreAllMocks();});
it('uses only same-origin tickets with bearer, cancellation and no-store for both requests', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ url: '/api/frames/a.b.c' })).mockResolvedValueOnce(new Response('png', { headers: { 'content-type': 'image/png', 'X-Frame-Geometry': JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1}) } }));
  await viewerApi.frame('synthetic-token', 'case', series, 2, { center: 40, width: 400 }, signal);
  expect(fetcher.mock.calls[0]).toEqual(['/api/frames/ticket', expect.objectContaining({ signal, cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: 'case', series_uid: '2.25.1', frame_index: 2, window: { center: 40, width: 400 } }) })]);
  expect(fetcher.mock.calls[1]).toEqual(['/api/frames/a.b.c', expect.objectContaining({ signal, cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } })]);
});
it.each(['https://elsewhere.invalid/a.b.c', '//elsewhere.invalid/a.b.c', '/api/frames/a.b.c?token=x', '/raw.dcm'])('rejects an unexpected ticket URL: %s', async url => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ url }));
  await expect(viewerApi.frame('token', 'case', series, 0, null, signal)).rejects.toThrow('帧地址无效');
  expect(fetcher).toHaveBeenCalledOnce();
});
it('reports account locking and rejects non-PNG bytes', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ url: '/api/frames/a.b.c' })).mockResolvedValueOnce(json({ message: '账号已停用' }, 429));
  await expect(viewerApi.frame('token', 'case', series, 0, null, signal)).rejects.toThrow('账号已停用');
  fetcher.mockResolvedValueOnce(json({ url: '/api/frames/a.b.c' })).mockResolvedValueOnce(new Response('raw', { headers: { 'content-type': 'application/dicom' } }));
  await expect(viewerApi.frame('token', 'case', series, 0, null, signal)).rejects.toThrow('帧格式无效');
});

it('reauthorizes before consuming a prefetched watermarked frame and never uses disk cache',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({url:'/api/frames/a.b.c'})).mockResolvedValueOnce(new Response('png',{headers:{'content-type':'image/png','X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1})}})).mockResolvedValueOnce(json({url:'/api/frames/a.b.c'}));
 viewerApi.preload('token','case',series,1,null);
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 const value=await viewerApi.frame('token','case',series,1,null,signal);expect(value.geometry.width).toBe(640);
 expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls[2][0]).toBe('/api/frames/ticket');
 for(const call of fetcher.mock.calls)expect(call[1]?.cache).toBe('no-store');
});
it('does not expose prefetched pixels after the live assignment or session is revoked',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(json({url:'/api/frames/a.b.c'})).mockResolvedValueOnce(new Response('png',{headers:{'content-type':'image/png','X-Frame-Geometry':JSON.stringify({width:640,height:480,row_spacing:1,column_spacing:1})}})).mockResolvedValueOnce(json({message:'分派已回收'},403));
 viewerApi.preload('token','case',series,1,null);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 await expect(viewerApi.frame('token','case',series,1,null,signal)).rejects.toMatchObject({status:403});
});
