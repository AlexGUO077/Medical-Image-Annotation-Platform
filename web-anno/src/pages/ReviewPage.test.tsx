import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { beforeEach,expect,it,vi } from 'vitest';
import { ReviewPage } from './ReviewPage';
import { reviewsApi } from '../reviews/api';
import { viewerApi,ViewerRequestError } from '../viewer/api';
import type { ReviewData } from '../reviews/types';
vi.mock('../taxonomy/api',()=>({taxonomyApi:{tree:vi.fn().mockResolvedValue({tree:[],sign_tags:[]})}}));
vi.mock('../reviews/api',()=>({reviewsApi:{read:vi.fn(),decide:vi.fn()}}));
vi.mock('./WorkbenchPage',()=>({FramePane:({layer}:{layer:{locked:Set<string>;comparison?:unknown[]}})=><div aria-label="只读影像">锁定对象 {layer.locked.size}，历史对象 {layer.comparison?.length??0}</div>}));
const data:ReviewData={case:{id:'case',case_no:'SYN-REVIEW',source:'synthetic',system_code:'resp',status:'审核中',clinical_text:'合成临床',age_band:null,sex:null,confirm_method:'临床综合诊断'},disease:{id:'disease',name:'合成疾病'},series:[{id:'series',series_uid:'2.25.1',modality:'CT',frame_count:300,default_window:{center:40,width:400}}],sentences:[{idx:0,text:'合成结节'}],attachments:[],review_mode:'peer',version:2,current_version:2,latest_review:null,annotations:[{id:'object',series_id:'series',tool:'point',geometry:{x:2,y:3},frame_start:0,frame_end:2,key_frame_index:1,part_id:'part',confidence:'typical',sign_tag_ids:['sign'],window_preset:'lung',report_sent_ids:[0]}]};
const session={token:'synthetic-token',role:'member' as const,quals:{resp:['review' as const]}};
const show=(onExpired?:()=>void)=>render(<MemoryRouter initialEntries={['/review/case']}><Routes><Route path="/review/:caseId" element={<ReviewPage session={session} onExpired={onExpired}/>}/></Routes></MemoryRouter>);
beforeEach(()=>{vi.mocked(reviewsApi.read).mockReset().mockResolvedValue(structuredClone(data));vi.mocked(reviewsApi.decide).mockReset().mockResolvedValue({review_id:'review',case_id:'case',version:2,status:'已发布',is_gold:true,reannotation:null});vi.spyOn(viewerApi,'clearPreloads').mockImplementation(()=>{});});
async function checks(failed=false){for(const [i,name] of ['脱敏是否合格','确诊依据是否完整','疾病标签是否正确'].entries()){
 fireEvent.mouseDown(screen.getByRole('combobox',{name}));const options=await screen.findAllByTitle(failed&&i===2?'不合格 / 缺失 / 错误':'合格 / 完整 / 正确');fireEvent.click(options.filter(e=>e.classList.contains('ant-select-item-option')).at(-1)!);
}}
it('keeps annotations locked, requires checks and confirmation, then disables new frame access',async()=>{
 show();await screen.findByRole('button',{name:'查看病例详情'});expect(screen.getByLabelText('只读影像')).toHaveTextContent('锁定对象 1');
 expect(screen.getByRole('button',{name:'审核通过'})).toBeDisabled();expect(screen.queryByRole('button',{name:'提交审核'})).not.toBeInTheDocument();
 await checks();fireEvent.click(screen.getByRole('button',{name:'审核通过'}));expect(reviewsApi.decide).not.toHaveBeenCalled();expect(await screen.findByText(/通过后病例立即发布/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'确认发布'}));expect(await screen.findByText('审核通过，当前版本已发布并锁定为金标准')).toBeInTheDocument();
 expect(reviewsApi.decide).toHaveBeenCalledWith('case',session.token,expect.any(AbortSignal),2,'通过',[{kind:'checks',deidentification:true,confirmation_basis:true,disease_label:true}]);
 expect(screen.getByRole('button',{name:'下一帧'})).toBeDisabled();expect(screen.getByRole('button',{name:'审核通过'})).toBeDisabled();
});
it('blocks a veto failure from passing and sends the object comment when returning',async()=>{
 vi.mocked(reviewsApi.decide).mockResolvedValue({review_id:'review',case_id:'case',version:2,status:'标注中',is_gold:false,reannotation:{assignment_id:'assignment',assignee_id:'author',reason:null}});
 show();await screen.findByRole('button',{name:'查看病例详情'});await checks(true);expect(screen.getByRole('button',{name:'审核通过'})).toBeDisabled();expect(screen.getByRole('button',{name:'打回重标'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('对象 1 审核意见'),{target:{value:'请调整轮廓。'}});fireEvent.click(screen.getByRole('button',{name:'打回重标'}));fireEvent.click(await screen.findByRole('button',{name:'确认打回'}));
 await screen.findByText('已打回，原标注人可继续修改');expect(vi.mocked(reviewsApi.decide).mock.calls[0][5][1]).toEqual({kind:'object',annotation_id:'object',text:'请调整轮廓。'});
});
it('loads the previous outline without replacing the version being reviewed',async()=>{
 vi.mocked(reviewsApi.read).mockImplementation(async(_id,_token,_signal,version)=>({...structuredClone(data),version:version??2}));
 show();await screen.findByRole('button',{name:'查看病例详情'});fireEvent.click(screen.getByRole('button',{name:'叠加上一版本'}));await screen.findByText('当前版本：实线；历史版本 1：同色虚线与低透明度');
 expect(screen.getByLabelText('只读影像')).toHaveTextContent('历史对象 1');await checks();fireEvent.click(screen.getByRole('button',{name:'审核通过'}));fireEvent.click(await screen.findByRole('button',{name:'确认发布'}));
 await waitFor(()=>expect(reviewsApi.decide).toHaveBeenCalled());expect(vi.mocked(reviewsApi.decide).mock.calls[0][3]).toBe(2);
});
it('shows a conflict without success, and clears the review on loss of authority',async()=>{
 vi.mocked(reviewsApi.decide).mockRejectedValue(new ViewerRequestError(403,'审核资格已撤销'));
 show();await screen.findByRole('button',{name:'查看病例详情'});await checks();fireEvent.click(screen.getByRole('button',{name:'审核通过'}));fireEvent.click(await screen.findByRole('button',{name:'确认发布'}));
 expect(await screen.findByText('审核资格已撤销')).toBeInTheDocument();expect(screen.queryByLabelText('只读影像')).not.toBeInTheDocument();expect(screen.queryByText('审核通过，当前版本已发布并锁定为金标准')).not.toBeInTheDocument();
});

it('submits the pinned quality assignment and clears the image immediately after offline',async()=>{
 vi.mocked(reviewsApi.read).mockResolvedValue({...structuredClone(data),case:{...data.case,status:'已发布'},review_kind:'spotcheck',assignment_id:'quality-id',review_version:2,started_at:'2026-10-02T13:00:00Z'});
 vi.mocked(reviewsApi.decide).mockResolvedValue({review_id:'quality-review',case_id:'case',version:2,status:'已下线',is_gold:true,reannotation:null,review_kind:'spotcheck',assigned_count:1,pending_count:8});
 show();await screen.findByRole('button',{name:'查看病例详情'});await checks(true);
 fireEvent.change(screen.getByLabelText('总体审核意见'),{target:{value:'请修正边界。'}});fireEvent.click(screen.getByRole('button',{name:'打回并下线'}));
 expect(await screen.findByText(/同时触发本轮同标注人/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'确认打回'}));
 await screen.findByText('抽检未通过，病例已下线');expect(screen.queryByLabelText('只读影像')).not.toBeInTheDocument();
 expect(vi.mocked(reviewsApi.decide).mock.calls[0][6]).toBe('quality-id');expect(screen.getByText(/待派 8 例/)).toBeInTheDocument();
});

it('clears the published quality view when a decision response cannot be trusted',async()=>{
 vi.mocked(reviewsApi.read).mockResolvedValue({...structuredClone(data),case:{...data.case,status:'已发布'},review_kind:'spotcheck',assignment_id:'quality-id',review_version:2,started_at:'2026-10-02T13:00:00Z'});
 vi.mocked(reviewsApi.decide).mockRejectedValue(new ViewerRequestError(502,'审核响应无效，请返回任务列表核对'));
 show();await screen.findByRole('button',{name:'查看病例详情'});await checks();fireEvent.click(screen.getByRole('button',{name:'审核通过'}));fireEvent.click(await screen.findByRole('button',{name:'确认发布'}));
 await screen.findByText('审核响应无效，请返回任务列表核对');expect(screen.queryByLabelText('只读影像')).not.toBeInTheDocument();
});
