import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {statsResult} from '../../../test/fixtures/synthetic/stats';
import {DashboardPage} from './DashboardPage';
import {statsApi} from '../dashboard/api';
import {ViewerRequestError} from '../viewer/api';
vi.mock('../dashboard/api',()=>({statsApi:{read:vi.fn(),options:vi.fn()}}));
const session={token:'synthetic-stats',role:'admin' as const,quals:{}};
beforeEach(()=>{
 vi.mocked(statsApi.read).mockReset().mockResolvedValue(statsResult);
 vi.mocked(statsApi.options).mockReset().mockResolvedValue({page:1,total:0,items:[]});
});
it('shows totals and count denominators, retaining all-range totals when paging',async()=>{
 vi.mocked(statsApi.read).mockResolvedValueOnce({...statsResult,total:21}).mockResolvedValueOnce({...statsResult,page:2,total:21,items:[]});
 render(<DashboardPage session={session}/>);
 expect(await screen.findByText('1 / 3 次普通审核')).toBeInTheDocument();expect(screen.getByText('1 / 2 次已完成抽检')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'北京时间每日完成量趋势'})).toBeInTheDocument();fireEvent.click(screen.getByTitle('2'));
 await waitFor(()=>expect(statsApi.read).toHaveBeenLastCalledWith(session.token,{page:2,pageSize:20,from:'2026-10-01',to:'2026-10-02'},expect.any(AbortSignal)));
 expect(await screen.findByText('1 / 3 次普通审核')).toBeInTheDocument();
});
it('sends combined dates, resets pagination and displays null denominators as no data',async()=>{
 const zero=statsResult.trend[1]!;vi.mocked(statsApi.read).mockResolvedValueOnce({...statsResult,summary:zero,items:[]});
 render(<DashboardPage session={session}/>);expect((await screen.findAllByText('暂无')).length).toBeGreaterThan(0);
 fireEvent.change(screen.getByLabelText('统计起始日期'),{target:{value:'2026-09-01'}});fireEvent.change(screen.getByLabelText('统计结束日期'),{target:{value:'2026-09-02'}});fireEvent.click(screen.getByRole('button',{name:'查询统计'}));
 await waitFor(()=>expect(statsApi.read).toHaveBeenLastCalledWith(session.token,{group_by:'task',from:'2026-09-01',to:'2026-09-02',page:1,pageSize:20},expect.any(AbortSignal)));
});
it('clears stale figures on request failure and leaves a retry action',async()=>{
 vi.mocked(statsApi.read).mockResolvedValueOnce(statsResult).mockRejectedValueOnce(new Error('统计查询失败'));
 render(<DashboardPage session={session}/>);await screen.findByText('1 / 3 次普通审核');fireEvent.click(screen.getByText('刷新统计'));
 expect(await screen.findByText('统计查询失败')).toBeInTheDocument();expect(screen.queryByText('1 / 3 次普通审核')).not.toBeInTheDocument();expect(screen.queryByText('暂无符合条件的审核结论')).not.toBeInTheDocument();
});
it('requests logout and removes figures when focus revalidation denies access',async()=>{
 const expired=vi.fn();vi.mocked(statsApi.read).mockResolvedValueOnce(statsResult).mockRejectedValueOnce(new ViewerRequestError(403,'账号停用'));
 render(<DashboardPage session={session} onExpired={expired}/>);await screen.findByText('1 / 3 次普通审核');fireEvent(window,new Event('focus'));
 await waitFor(()=>expect(expired).toHaveBeenCalled());expect(screen.queryByText('1 / 3 次普通审核')).not.toBeInTheDocument();
});
it('does not request statistics or filter lists for members',()=>{
 render(<DashboardPage session={{...session,role:'member'}}/>);expect(screen.getByText('需要管理员权限')).toBeInTheDocument();expect(statsApi.read).not.toHaveBeenCalled();expect(statsApi.options).not.toHaveBeenCalled();
});
