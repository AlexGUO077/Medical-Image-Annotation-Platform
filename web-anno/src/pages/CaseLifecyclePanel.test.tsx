import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CaseLifecyclePanel} from './CaseLifecyclePanel';
import type {CaseDetail} from '../cases/detail-api';
import {casesLifecycleApi,LifecycleRequestError} from '../cases/lifecycle-api';
const detail:CaseDetail={id:'case',case_no:'SYN-LIFECYCLE',status:'已发布',annotation_version:3,source:'synthetic',system_code:'resp',confirm_method:'临床综合诊断',clinical_text:null,age_band:null,sex:null,teaching_fields:null,attachments:[]};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('requires confirmation and prevents duplicate decisions while the request is pending',async()=>{
 let resolve!:(value:{case_id:string;status:'已下线';version:number})=>void;
 const change=vi.spyOn(casesLifecycleApi,'change').mockReturnValue(new Promise(r=>{resolve=r;})),changed=vi.fn();
 render(<CaseLifecyclePanel detail={detail} token="token" onChanged={changed} onDenied={vi.fn()} onReload={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'下线病例'}));expect(change).not.toHaveBeenCalled();await screen.findByText(/旧金标准及审核历史保留/);
 const confirmButton=screen.getByRole('button',{name:'确认下线'});fireEvent.click(confirmButton);fireEvent.click(confirmButton);
 expect(change).toHaveBeenCalledTimes(1);expect(change).toHaveBeenCalledWith('token','case',3,'offline',expect.any(AbortSignal));
 resolve({case_id:'case',status:'已下线',version:3});await waitFor(()=>expect(changed).toHaveBeenCalledWith({case_id:'case',status:'已下线',version:3}));
});
it('reactivates only offline synthetic cases and uses the original version',async()=>{
 const change=vi.spyOn(casesLifecycleApi,'change').mockResolvedValue({case_id:'case',status:'待分配',version:4}),changed=vi.fn();
 const props={token:'token',onChanged:changed,onDenied:vi.fn(),onReload:vi.fn()};const view=render(<CaseLifecyclePanel {...props} detail={{...detail,status:'已下线'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'重新启用病例'}));await screen.findByText(/复制为下一版本/);fireEvent.click(screen.getByRole('button',{name:'确认重新启用'}));
 await waitFor(()=>expect(changed).toHaveBeenCalledWith({case_id:'case',status:'待分配',version:4}));expect(change).toHaveBeenCalledWith('token','case',3,'reactivate',expect.any(AbortSignal));
 view.rerender(<CaseLifecyclePanel {...props} detail={{...detail,source:'teacher_provided_teaching'}}/>);expect(screen.queryByRole('button',{name:'下线病例'})).not.toBeInTheDocument();
});
it('requires a fresh read after conflicts and clears data through its parent on denial',async()=>{
 const change=vi.spyOn(casesLifecycleApi,'change').mockRejectedValueOnce(new LifecycleRequestError(409,'版本已变化')).mockRejectedValueOnce(new LifecycleRequestError(403,'会话已失效'));
 const reload=vi.fn().mockResolvedValue(undefined),denied=vi.fn(),changed=vi.fn();render(<CaseLifecyclePanel detail={detail} token="token" onChanged={changed} onDenied={denied} onReload={reload}/>);
 fireEvent.click(screen.getByRole('button',{name:'下线病例'}));fireEvent.click(await screen.findByRole('button',{name:'确认下线'}));await screen.findByText('版本已变化');
 expect(changed).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'下线病例'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'重新读取病例'}));await waitFor(()=>expect(screen.getByRole('button',{name:'下线病例'})).toBeEnabled());expect(reload).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'下线病例'}));fireEvent.click(await screen.findByRole('button',{name:'确认下线'}));await waitFor(()=>expect(denied).toHaveBeenCalledWith('会话已失效'));expect(changed).not.toHaveBeenCalled();
});
