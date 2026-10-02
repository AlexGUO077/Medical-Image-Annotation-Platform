import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { AttachmentPreview } from './AttachmentPreview';
import { viewerApi,ViewerRequestError } from './api';
const attachments=[{id:'one',filename:'合成附件',kind:'其他'}];
const style=window.getComputedStyle.bind(window);
beforeEach(()=>{
 vi.spyOn(window,'getComputedStyle').mockImplementation(el=>style(el));
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:synthetic')});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('reads one confirmed page at a time and revokes page URLs on change and close',async()=>{
 const preview=vi.spyOn(viewerApi,'attachment').mockResolvedValue({blob:new Blob(['synthetic'],{type:'image/png'}),page_count:2});
 render(<AttachmentPreview token="token" caseId="case" attachments={attachments}/>);
 fireEvent.click(screen.getByRole('button',{name:'合成附件（其他）'}));await screen.findByRole('img',{name:'已确认附件安全预览'});
 expect(preview).toHaveBeenLastCalledWith('token','case','one',1,expect.any(AbortSignal));
 fireEvent.click(screen.getByRole('button',{name:'附件下一页'}));await waitFor(()=>expect(preview).toHaveBeenLastCalledWith('token','case','one',2,expect.any(AbortSignal)));
 await screen.findByRole('img',{name:'已确认附件安全预览'});expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
});
it('ignores an old preview after closing and surfaces expired authorization',async()=>{
 let finish!:(value:{blob:Blob;page_count:number})=>void;
 const preview=vi.spyOn(viewerApi,'attachment').mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),expired=vi.fn();
 render(<AttachmentPreview token="token" caseId="case" attachments={attachments} onExpired={expired}/>);
 fireEvent.click(screen.getByRole('button',{name:'合成附件（其他）'}));await waitFor(()=>expect(finish).toBeDefined());
 const signal=preview.mock.calls[0][4];fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(signal.aborted).toBe(true);
 finish({blob:new Blob(['synthetic']),page_count:1});await Promise.resolve();expect(URL.createObjectURL).not.toHaveBeenCalled();
 preview.mockRejectedValue(new ViewerRequestError(401,'登录失效'));fireEvent.click(screen.getByRole('button',{name:'合成附件（其他）'}));
 expect(await screen.findByText('登录失效')).toBeInTheDocument();expect(expired).toHaveBeenCalledOnce();
});
