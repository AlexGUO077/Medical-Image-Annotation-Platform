import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,expect,it,vi } from 'vitest';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { LibraryPage } from './LibraryPage';
import { LibraryCasePage } from './LibraryCasePage';
import { libraryApi } from '../library/api';
import { libraryData,librarySearch } from '../../../test/fixtures/synthetic/library';
import { viewerApi,ViewerRequestError } from '../viewer/api';
vi.mock('../library/api',()=>({libraryApi:{read:vi.fn(),search:vi.fn()}}));
vi.mock('../taxonomy/api',()=>({taxonomyApi:{tree:vi.fn().mockResolvedValue({tree:[],sign_tags:[]})}}));
vi.mock('../viewer/api',async original=>({...await original<typeof import('../viewer/api')>(),viewerApi:{clearPreloads:vi.fn(),frame:vi.fn()}}));
vi.mock('./WorkbenchPage',()=>({FramePane:({libraryVersion,onDenied}:{libraryVersion:number;onDenied():void})=><div aria-label="版本绑定只读视口">版本 {libraryVersion}<button onClick={onDenied}>模拟帧拒绝</button></div>}));
const session={token:'synthetic-library',role:'member' as const,quals:{resp:['review' as const]}};
beforeEach(()=>{vi.mocked(libraryApi.read).mockReset().mockResolvedValue(libraryData);vi.mocked(libraryApi.search).mockReset().mockResolvedValue({...librarySearch,items:librarySearch.items.map(i=>({...i,thumbnail:null}))});vi.mocked(viewerApi.clearPreloads).mockClear();});
it('uses server pagination and reports search failure without claiming an empty result',async()=>{
 vi.mocked(libraryApi.search).mockResolvedValueOnce({...librarySearch,items:[{...librarySearch.items[0],thumbnail:null}],total:21}).mockRejectedValueOnce(new ViewerRequestError(503,'全文检索暂不可用'));
 render(<MemoryRouter><LibraryPage session={session}/></MemoryRouter>);expect(await screen.findByText('共 21 例')).toBeInTheDocument();fireEvent.click(screen.getByTitle('2'));
 expect(await screen.findByText('全文检索暂不可用')).toBeInTheDocument();expect(libraryApi.search).toHaveBeenLastCalledWith(session.token,{page:2,pageSize:20},expect.any(AbortSignal));expect(screen.queryByText('SYN-LIBRARY-DX')).not.toBeInTheDocument();expect(screen.queryByText('暂无符合条件的已发布病例')).not.toBeInTheDocument();
});
it('keeps published detail read-only and clears all data on frame denial',async()=>{
 render(<MemoryRouter initialEntries={[`/library/${libraryData.case.id}`]}><Routes><Route path="/library/:caseId" element={<LibraryCasePage session={session}/>}/></Routes></MemoryRouter>);
 expect(await screen.findByLabelText('版本绑定只读视口')).toHaveTextContent('版本 1');expect(screen.queryByText('审核通过')).not.toBeInTheDocument();expect(screen.queryByText('保存')).not.toBeInTheDocument();fireEvent.click(screen.getByText('模拟帧拒绝'));expect(await screen.findByText('影像或附件已不可访问，请重新打开病例')).toBeInTheDocument();expect(screen.queryByLabelText('版本绑定只读视口')).not.toBeInTheDocument();expect(screen.queryByText('SYN-LIBRARY-DX')).not.toBeInTheDocument();expect(viewerApi.clearPreloads).toHaveBeenCalledWith(session.token,libraryData.case.id);
});
it('revalidates publication on focus and never silently replaces a pinned version',async()=>{
 vi.mocked(libraryApi.read).mockResolvedValueOnce(libraryData).mockResolvedValueOnce({...libraryData,version:2,current_version:2});
 render(<MemoryRouter initialEntries={[`/library/${libraryData.case.id}`]}><Routes><Route path="/library/:caseId" element={<LibraryCasePage session={session}/>}/></Routes></MemoryRouter>);
 await screen.findByLabelText('版本绑定只读视口');fireEvent(window,new Event('focus'));await waitFor(()=>expect(screen.getByText('已发布版本已变化，请重新打开病例')).toBeInTheDocument());expect(screen.queryByLabelText('版本绑定只读视口')).not.toBeInTheDocument();
});
