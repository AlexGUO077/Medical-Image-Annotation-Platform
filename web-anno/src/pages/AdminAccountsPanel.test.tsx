import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {AdminAccountsPanel} from './AdminAccountsPanel';
import {adminApi} from '../admin/api';
import {ViewerRequestError} from '../viewer/api';
import {adminUserFixture as user} from '../../../test/fixtures/synthetic/admin-users';
vi.mock('../admin/api',()=>({adminApi:{users:vi.fn(),createUser:vi.fn(),updateUser:vi.fn()}}));
const session={role:'admin' as const,quals:{},token:'x.'+btoa(JSON.stringify({sub:'20000000-0000-4000-8000-000000000001'}))+'.x'};
// AntD uses the same test-only id for simultaneous modals; scope by the visible title.
const dialog=async(title:string)=>(await screen.findByText(title,{exact:true})).closest('[role=dialog]') as HTMLElement;
beforeEach(()=>{vi.mocked(adminApi.users).mockReset().mockResolvedValue({items:[user],total:1,page:1,pageSize:20});vi.mocked(adminApi.createUser).mockReset().mockResolvedValue({id:user.id,username:user.username,initial_password:'SYNTHETIC-UNUSED',must_change_password:true});vi.mocked(adminApi.updateUser).mockReset().mockResolvedValue({id:user.id,updated:true,released_assignments:1});});
it('opens an account only after confirmation, keeps credentials in memory and clears them on close',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem');render(<AdminAccountsPanel session={session} onExpired={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'开通账号'}));fireEvent.change(screen.getByLabelText('新账号姓名'),{target:{value:'合成新成员'}});fireEvent.change(screen.getByLabelText('新账号有效期'),{target:{value:'2099-12-31'}});fireEvent.click(screen.getByLabelText('呼吸标注'));fireEvent.click(screen.getByRole('button',{name:'确认开通'}));
 const confirmation=await dialog('确认账号操作');expect(adminApi.createUser).not.toHaveBeenCalled();fireEvent.click(within(confirmation).getByRole('button',{name:/^(OK|确\s*定)$/}));
 const handoff=await dialog('本次账号凭据交接');expect(screen.getAllByLabelText('本次初始密码')).toHaveLength(1);expect(adminApi.createUser).toHaveBeenCalledWith(session.token,expect.objectContaining({role:'member',quals:{resp:['annotate']},expire_at:'2099-12-31'}));expect(within(handoff).getByLabelText('本次初始密码')).toHaveAttribute('type','password');expect(storage).not.toHaveBeenCalled();fireEvent.click(within(handoff).getByRole('button',{name:'已完成交接并清除'}));await waitFor(()=>expect(screen.queryByDisplayValue('SYNTHETIC-UNUSED')).not.toBeInTheDocument());storage.mockRestore();
});
it('edits system-specific capabilities with confirmation and submits only changed fields',async()=>{
 render(<AdminAccountsPanel session={session} onExpired={vi.fn()}/>);fireEvent.click(await screen.findByRole('button',{name:'编辑资格与有效期'}));fireEvent.click(screen.getByLabelText('呼吸标注'));fireEvent.click(screen.getByLabelText('呼吸审核'));fireEvent.click(screen.getByRole('button',{name:'保存账号变更'}));const confirmation=await dialog('确认账号操作');expect(adminApi.updateUser).not.toHaveBeenCalled();fireEvent.click(within(confirmation).getByRole('button',{name:/^(OK|确\s*定)$/}));await waitFor(()=>expect(adminApi.updateUser).toHaveBeenCalledWith(session.token,{id:user.id,quals:{resp:['review']}}));expect(await screen.findByText(/释放 1 个失效分派/)).toBeInTheDocument();
});
it('does not permit self-disable or self MFA reset and exits after a self qualification change',async()=>{
 vi.mocked(adminApi.users).mockResolvedValue({items:[{...user,id:'20000000-0000-4000-8000-000000000001',role:'admin',mfa_enabled:true}],total:1,page:1,pageSize:20});const expired=vi.fn();render(<AdminAccountsPanel session={session} onExpired={expired}/>);expect(await screen.findByRole('button',{name:'停用账号'})).toBeDisabled();expect(screen.getByRole('button',{name:'重置 2FA'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'编辑资格与有效期'}));fireEvent.click(screen.getByLabelText('呼吸标注'));fireEvent.click(screen.getByRole('button',{name:'保存账号变更'}));fireEvent.click(within(await dialog('确认账号操作')).getByRole('button',{name:/^(OK|确\s*定)$/}));await waitFor(()=>expect(expired).toHaveBeenCalled());
});
it('clears stale rows and editor on live denial; members request no management API',async()=>{
 const expired=vi.fn(),view=render(<AdminAccountsPanel session={session} onExpired={expired}/>);fireEvent.click(await screen.findByRole('button',{name:'编辑资格与有效期'}));vi.mocked(adminApi.users).mockRejectedValue(new ViewerRequestError(403,'账号不可用'));fireEvent.click(screen.getByRole('button',{name:'刷新账号'}));await waitFor(()=>expect(expired).toHaveBeenCalled());expect(screen.queryByText(user.username,{exact:true})).not.toBeInTheDocument();view.unmount();vi.mocked(adminApi.users).mockClear();render(<AdminAccountsPanel session={{...session,role:'member'}} onExpired={vi.fn()}/>);expect(adminApi.users).not.toHaveBeenCalled();
});
