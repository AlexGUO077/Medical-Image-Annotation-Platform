import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnotationSaveSession } from './save-session';
import { AnnotationRequestError } from './api';
import type { Annotation, AnnotationRead, AnnotationVersion } from './types';
import type { AnnotationDraft } from './drafts';
const point=(x=1):Annotation=>({id:'stable',series_id:'series',tool:'point',geometry:{x,y:2},frame_start:0,frame_end:0,key_frame_index:0,window_preset:null,part_id:'part',sign_tag_ids:['sign'],confidence:'typical',report_sent_ids:[]});
const read=(version=0,annotations:Annotation[]=[]):AnnotationRead=>({version,current_version:version,annotations});
function deferred<T>(){let resolve!:(value:T)=>void, reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(draft?:AnnotationDraft){
 const transport={read:vi.fn().mockResolvedValue(read()),save:vi.fn().mockImplementation(async(version:number,annotations:Annotation[])=>({version:version+1,annotations}))};
 const store={read:vi.fn().mockResolvedValue(draft),write:vi.fn().mockResolvedValue(undefined),remove:vi.fn().mockResolvedValue(undefined)};
 const notify=vi.fn();const session=new AnnotationSaveSession(transport,store,notify);return {session,transport,store,notify};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('debounces completed edits for two seconds and snapshots caller-owned arrays',async()=>{
 const {session,transport,store}=fixture();await session.start();const objects=[point()];session.change(objects);objects[0].report_sent_ids.push(-1);
 await vi.advanceTimersByTimeAsync(1900);session.change([point(3)]);await vi.advanceTimersByTimeAsync(1999);expect(transport.save).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(transport.save).toHaveBeenCalledOnce();expect(transport.save.mock.calls[0][1][0].geometry).toEqual({x:3,y:2});expect(session.snapshot().status).toBe('saved');expect(store.remove).toHaveBeenCalledOnce();await session.dispose();
});
it('serializes edits during a request and manual save drains the newest batch without replacing it with an old response',async()=>{
 const {session,transport}=fixture();await session.start();const first=deferred<AnnotationVersion>();transport.save.mockReturnValueOnce(first.promise);
 session.change([point()]);const saving=session.saveNow();session.change([point(9)]);expect(transport.save).toHaveBeenCalledOnce();
 first.resolve({version:1,annotations:[point()]});await saving;
 expect(transport.save).toHaveBeenCalledTimes(2);expect(transport.save.mock.calls[1].slice(0,2)).toEqual([1,[point(9)]]);expect(session.snapshot()).toMatchObject({version:2,annotations:[point(9)],dirty:false});await session.dispose();
});
it('preserves the last edit debounce when an automatic save is still in flight',async()=>{
 const {session,transport}=fixture();await session.start();const first=deferred<AnnotationVersion>();transport.save.mockReturnValueOnce(first.promise);
 session.change([point()]);await vi.advanceTimersByTimeAsync(2000);session.change([point(8)]);first.resolve({version:1,annotations:[point()]});await vi.advanceTimersByTimeAsync(1999);expect(transport.save).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(1);expect(transport.save).toHaveBeenCalledTimes(2);await session.dispose();
});
it('keeps offline changes locally and reauthorizes before sending after reconnection',async()=>{
 const {session,transport,store}=fixture();await session.start();session.setOnline(false);session.change([point()]);await vi.advanceTimersByTimeAsync(5000);expect(transport.save).not.toHaveBeenCalled();expect(store.write).toHaveBeenLastCalledWith({baseVersion:0,annotations:[point()]});
 session.setOnline(true);await vi.advanceTimersByTimeAsync(2000);expect(transport.read).toHaveBeenCalledTimes(2);expect(transport.save).toHaveBeenCalledOnce();await session.dispose();
});
it('does not blindly retry a possibly committed request after a lost response',async()=>{
 const {session,transport}=fixture();await session.start();transport.save.mockRejectedValueOnce(new TypeError('network'));session.change([point()]);await session.saveNow();expect(session.snapshot().status).toBe('error');
 transport.read.mockResolvedValue(read(1,[point(7)]));await session.recover();await vi.advanceTimersByTimeAsync(5000);expect(session.snapshot()).toMatchObject({status:'conflict',annotations:[point()],server:read(1,[point(7)])});expect(transport.save).toHaveBeenCalledOnce();await session.dispose();
});
it('loads persisted drafts only after authorization and blocks stale versions',async()=>{
 const {session,transport,store}=fixture({baseVersion:0,annotations:[point()]});transport.read.mockResolvedValue(read(2));await session.start();expect(transport.read.mock.invocationCallOrder[0]).toBeLessThan(store.read.mock.invocationCallOrder[0]);expect(session.snapshot().status).toBe('conflict');await session.saveNow();expect(transport.save).not.toHaveBeenCalled();
 transport.read.mockResolvedValue(read(3,[point(3)]));await session.useServer();await session.dispose();expect(session.snapshot()).toMatchObject({version:3,annotations:[point(3)],dirty:false});expect(store.remove).toHaveBeenCalledOnce();
});
it.each([401,403])('does not expose drafts after authorization failure %s',async status=>{
 const {session,transport,store}=fixture({baseVersion:0,annotations:[point()]});transport.read.mockRejectedValue(new AnnotationRequestError(status,'失效'));await session.start();expect(store.read).not.toHaveBeenCalled();expect(session.snapshot()).toMatchObject({status:'blocked',annotations:[]});await session.dispose();
});
it('persists new edits against acknowledged versions without clearing them',async()=>{
 const {session,transport,store}=fixture();await session.start();const response=deferred<AnnotationVersion>();transport.save.mockReturnValueOnce(response.promise);session.change([point()]);await vi.advanceTimersByTimeAsync(2000);session.change([point(9)]);response.resolve({version:1,annotations:[point()]});await vi.advanceTimersByTimeAsync(0);await session.dispose();expect(store.remove).not.toHaveBeenCalled();expect(store.write).toHaveBeenLastCalledWith({baseVersion:1,annotations:[point(9)]});
});
it('aborts and ignores late replies after navigation, leaving recoverable drafts',async()=>{
 const {session,transport,store,notify}=fixture();await session.start();const response=deferred<AnnotationVersion>();transport.save.mockReturnValueOnce(response.promise);session.change([point()]);await vi.advanceTimersByTimeAsync(2000);await session.dispose();const calls=notify.mock.calls.length;response.resolve({version:1,annotations:[point()]});await vi.advanceTimersByTimeAsync(10);expect(transport.save.mock.calls[0][2].aborted).toBe(true);expect(notify).toHaveBeenCalledTimes(calls);expect(store.remove).not.toHaveBeenCalled();
});
it('makes persistence failure visible while allowing online server save',async()=>{
 const {session,store}=fixture();await session.start();store.write.mockRejectedValue(new Error('quota'));session.change([point()]);await vi.advanceTimersByTimeAsync(0);expect(session.snapshot().storageError).toContain('存储失败');await session.saveNow();expect(session.snapshot()).toMatchObject({status:'saved',storageError:undefined});await session.dispose();
});
it('keeps empty snapshots and never retries conflict on further edits',async()=>{
 const {session,transport,store}=fixture();await session.start();transport.save.mockRejectedValueOnce(new AnnotationRequestError(409,'冲突'));session.change([]);await session.saveNow();session.change([point()]);await vi.advanceTimersByTimeAsync(9000);expect(transport.save).toHaveBeenCalledOnce();expect(store.write).toHaveBeenCalledWith({baseVersion:0,annotations:[]});await session.dispose();
});
it('does not permit editing when an existing draft cannot be read',async()=>{
 const {session,store,transport}=fixture();store.read.mockRejectedValue(new Error('unavailable'));await session.start();session.change([point()]);await session.saveNow();expect(session.snapshot().status).toBe('error');expect(transport.save).not.toHaveBeenCalled();expect(store.write).not.toHaveBeenCalled();await session.dispose();
});
