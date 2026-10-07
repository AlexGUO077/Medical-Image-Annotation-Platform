import {expect,it,vi} from 'vitest';
import {pageInput,lockAdmins} from './exports-input';
import {safeAuditDetail} from '../audit/audit-query.service';
it('rejects repeated, overflowing and unknown paging, and keeps parameter defaults',()=>{
 expect(pageInput({})).toEqual({page:1,pageSize:20});for(const q of [{page:['1','2']},{page:'01'},{pageSize:'101'},{page:'9007199254740991',pageSize:'100'},{raw:'true'}])expect(()=>pageInput(q)).toThrow();
});
it('projects only audit tracing metadata, without mappings, clinical text, tokens or storage paths',()=>{
 expect(safeAuditDetail({version:1,review_kind:'normal',result:'通过',case_versions:[{id:'synthetic',version:1,token:'private'}],clinical_text:'private',password_hash:'private',object_key:'private',comments:'private',reason:'/private/file'})).toEqual({version:1,review_kind:'normal',result:'通过',case_versions:[{id:'synthetic',version:1}]});
});
it('requires current enabled administrator security settings for both participants',async()=>{
 const user={id:'synthetic',role:'admin',status:'active',updated_at:new Date(),expire_at:'2099-12-31',must_change_password:false,mfa_secret_encrypted:'synthetic'};
 const query=vi.fn().mockResolvedValue([user]);await expect(lockAdmins({query} as never,user as never,['absent'])).rejects.toThrow('管理员账号不可用');
 query.mockResolvedValue([{...user,status:'disabled'}]);await expect(lockAdmins({query} as never,user as never)).rejects.toThrow('管理员账号不可用');
 query.mockResolvedValue([user]);await expect(lockAdmins({query} as never,{...user,updated_at:new Date(0)} as never)).rejects.toThrow('会话已失效');
});
