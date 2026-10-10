import { CaseDetails, WorkspaceLayout } from '../viewer/WorkspaceLayout';
import { ViewerToolbar, SeriesNavigation } from '../viewer/ViewerToolbar';
import { isTextInput, objectColor } from '../viewer/workspaceConfig';
import { Alert,Button,Checkbox,Empty,Input,Modal,Select,Space,Spin,Tabs } from 'antd';
import { useEffect,useRef,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import type { Annotation } from '../annotations/types';
import { toolNames } from '../annotations/AnnotationPanel';
import { FramePane } from './WorkbenchPage';
import { viewerApi,ViewerRequestError,type FrameGeometry,type FrameWindow } from '../viewer/api';
import { AttachmentPreview } from '../viewer/AttachmentPreview';
import { reviewsApi } from '../reviews/api';
import { ReviewFeedback } from '../reviews/ReviewFeedback';
import type { ReviewChecks,ReviewComment,ReviewData,ReviewResult } from '../reviews/types';
import { taxonomyApi } from '../taxonomy/api';
import type { TaxonomyTreeResponse } from '../taxonomy/types';
const checkNames={deidentification:'脱敏是否合格',confirmation_basis:'确诊依据是否完整',disease_label:'疾病标签是否正确'};
const errorText=(e:unknown)=>e instanceof Error?e.message:'审核请求失败';
export function ReviewPage({session,onExpired}:{session:Session;onExpired?():void}){
 const {caseId=''}=useParams(),[data,setData]=useState<ReviewData>(),[error,setError]=useState<string>(),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(undefined);setError(undefined);
  reviewsApi.read(caseId,session.token,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted){setError(errorText(e));if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});
  return()=>{controller.abort();viewerApi.clearPreloads(session.token,caseId);};
 },[caseId,session.token,retry]);
 if(error)return <Alert type="error" message={error} action={<Button onClick={()=>setRetry(n=>n+1)}>重试读取审核台</Button>}/>;
 if(!data||data.case.id!==caseId)return <Spin tip="加载审核台"><div/></Spin>;
 return <ReviewContent key={`${caseId}:${session.token}:${retry}`} data={data} session={session} onExpired={onExpired} onReload={()=>setRetry(n=>n+1)}/>;
}
function ReviewContent({data,session,onExpired,onReload}:{data:ReviewData;session:Session;onExpired?():void;onReload():void}){
 const [dictionary,setDictionary]=useState<TaxonomyTreeResponse>(),[dictionaryError,setDictionaryError]=useState<string>();
 useEffect(()=>{let live=true;taxonomyApi.tree(session.token).then(value=>{if(live)setDictionary(value);}).catch(e=>{if(live)setDictionaryError(errorText(e));});return()=>{live=false;};},[session.token]);
 const [seriesId,setSeriesId]=useState(data.series[0]?.id??''),[frame,setFrame]=useState(0),[window,setWindow]=useState<FrameWindow|null>(data.series[0]?.default_window??null);
 const [geometry,setGeometry]=useState<FrameGeometry>();
 const [focus,setFocus]=useState(false),[windowDrag,setWindowDrag]=useState(true),[tool,setTool]=useState<'pan'|'select'|'zoom'|'measure'>('pan'),[selected,setSelected]=useState<string>(),[hidden,setHidden]=useState(new Set<string>());
 const [checks,setChecks]=useState<Partial<Omit<ReviewChecks,'kind'>>>({}),[notes,setNotes]=useState<Record<string,string>>({}),[overall,setOverall]=useState('');
 const [comparison,setComparison]=useState<Annotation[]>(),[historyVersion,setHistoryVersion]=useState<number>(),[historyBusy,setHistoryBusy]=useState(false);
 const [confirm,setConfirm]=useState<'通过'|'打回'>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[denied,setDenied]=useState(false),[result,setResult]=useState<ReviewResult>();
 const controller=useRef<AbortController>(),historyController=useRef<AbortController>(),pending=useRef(false);
 useEffect(()=>()=>{controller.current?.abort();historyController.current?.abort();viewerApi.clearPreloads(session.token,data.case.id);},[session.token,data.case.id]);
 const series=data.series.find(s=>s.id===seriesId),selectedObject=data.annotations.find(a=>a.id===selected);
 const quality=['spotcheck','recheck'].includes(data.review_kind??'');
 const qualityName=data.review_kind==='spotcheck'?'抽检':'全面复核';
 const readOnly=busy||!!result||denied;
 const complete=Object.keys(checkNames).every(k=>typeof checks[k as keyof typeof checkNames]==='boolean');
 const canPass=complete&&Object.keys(checkNames).every(k=>checks[k as keyof typeof checkNames]===true)&&!!data.disease;
 const comments:ReviewComment[]=[{kind:'checks',deidentification:checks.deidentification!,confirmation_basis:checks.confirmation_basis!,disease_label:checks.disease_label!},
  ...data.annotations.flatMap(a=>notes[a.id]?.trim()?[{kind:'object' as const,annotation_id:a.id,text:notes[a.id].trim()}]:[]),...(overall.trim()?[{kind:'overall' as const,text:overall.trim()}]:[])];
 const select=(id:string)=>{const a=data.annotations.find(a=>a.id===id);if(!a)return;setSelected(id);if(!result){setSeriesId(a.series_id);setFrame(a.key_frame_index);const next=data.series.find(s=>s.id===a.series_id);if(next?.id!==seriesId){setWindow(next?.default_window??null);}}
  document.getElementById(`review-report-${a.report_sent_ids[0]}`)?.scrollIntoView?.({block:'nearest'});
 };
 const failed=(e:unknown)=>{setError(errorText(e));if(e instanceof ViewerRequestError&&(e.status===401||e.status===403||(quality&&(e.status===409||e.status===502)))){setDenied(true);viewerApi.clearPreloads(session.token,data.case.id);if(e.status===401)onExpired?.();}};
 const decide=async()=>{
  if(pending.current||readOnly||!confirm||!complete||(confirm==='通过'?!canPass:comments.length<2))return;
  pending.current=true;setBusy(true);setError(undefined);const next=new AbortController();controller.current=next;
  try{const value=await reviewsApi.decide(data.case.id,session.token,next.signal,data.current_version,confirm,comments,...(quality?[data.assignment_id]:[]));if(next.signal.aborted)return;
    setResult(value);setConfirm(undefined);setWindowDrag(false);setTool('pan');historyController.current?.abort();viewerApi.clearPreloads(session.token,data.case.id);
  }catch(e){if(!next.signal.aborted)failed(e);}finally{if(!next.signal.aborted){pending.current=false;setBusy(false);}}
 };
 const loadPrevious=async()=>{if(readOnly||historyBusy||data.current_version===0)return;const next=new AbortController();historyController.current?.abort();historyController.current=next;setHistoryBusy(true);setError(undefined);
  try{const old=await reviewsApi.read(data.case.id,session.token,next.signal,data.current_version-1);if(next.signal.aborted)return;if(old.current_version!==data.current_version)throw new Error('当前版本已变化，请重新加载审核台');setComparison(old.annotations);setHistoryVersion(old.version);}
  catch(e){if(!next.signal.aborted)failed(e);}finally{if(!next.signal.aborted)setHistoryBusy(false);}
 };
 if(result?.status==='已下线')return <Alert type="success" message={`${qualityName}未通过，病例已下线`} description={`新增全面复核：已分派 ${result.assigned_count??0} 例、待派 ${result.pending_count??0} 例；旧金标准保留，重标须管理员重新启用。`} action={<Link to="/tasks">返回任务列表</Link>}/>;
 if(denied)return <Alert type="error" message={error??'审核权限已失效'} action={<Link to="/tasks">返回任务列表</Link>}/>;
 return <section className="workbench" aria-label="只读审核台" tabIndex={0} onKeyDown={e=>{if(isTextInput(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Escape'){setFocus(false);setTool('pan');setWindowDrag(true);}if(e.key.toLowerCase()==='w'){setTool('pan');setWindowDrag(true);}if(e.key.toLowerCase()==='z'){setTool('zoom');setWindowDrag(false);}if(e.key.toLowerCase()==='p'){setTool('pan');setWindowDrag(false);}if(e.key.toLowerCase()==='m'&&geometry?.row_spacing&&geometry?.column_spacing){setTool('measure');setWindowDrag(false);}if(!readOnly&&series&&['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){e.preventDefault();setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1))));}}}>
  <Space className="workbench-heading"><span>审核台</span><CaseDetails data={data}/><span>{quality?qualityName:data.review_mode==='self'?'自审':'他审'} · {result?.status??data.case.status} · 版本 {data.current_version} · 标注只读</span><Link to="/tasks">返回任务列表</Link></Space>
  {error&&<Alert type="error" message={error} action={!result&&<Button disabled={busy} onClick={onReload}>重新加载审核台</Button>}/>}
  {result&&<Alert type="success" message={result.status==='已发布'?(quality?`${qualityName}通过，病例继续发布`:'审核通过，当前版本已发布并锁定为金标准'):result.status==='标注中'?'已打回，原标注人可继续修改':'已打回并退至待分配'} description={result.reannotation?.reason?`原标注人暂不能承接（${({account_unavailable:'账号不可用',qualification_removed:'资格不足',capacity_full:'在途上限已满'} as Record<string,string>)[result.reannotation.reason]??result.reannotation.reason}），按原任务模式重新分发。`:result.status==='已发布'?'审核已结束。本页保留当前影像与标注供只读核对。':undefined}/>}
  <ReviewFeedback review={data.latest_review} annotations={data.annotations} onSelect={select}/>
  {dictionaryError&&<Alert type="warning" message={`标签规范读取失败：${dictionaryError}`}/>}
  <Space><Button disabled={readOnly||data.current_version===0} loading={historyBusy} onClick={()=>void loadPrevious()}>叠加上一版本</Button>{comparison&&<><span>当前版本：实线；历史版本 {historyVersion}：同色虚线与低透明度</span><Button onClick={()=>{setComparison(undefined);setHistoryVersion(undefined);}}>关闭历史叠加</Button></>}</Space>
<WorkspaceLayout focus={focus} onFocus={setFocus} rightTitle="审核检查与批注" left={<Tabs items={[
    {key:'report',label:'报告',children:<ol className="workbench-report">{data.sentences.map(s=><li id={`review-report-${s.idx}`} key={s.idx} data-linked={selectedObject?.report_sent_ids.includes(s.idx)} style={{borderLeftColor:selectedObject?.report_sent_ids.includes(s.idx)?objectColor(data.annotations.indexOf(selectedObject)):undefined}}><span>[{s.idx}] {s.text}</span><div className="report-object-links">{data.annotations.filter(a=>a.report_sent_ids.includes(s.idx)).map(a=><button type="button" key={a.id} disabled={readOnly} onClick={()=>select(a.id)} style={{color:objectColor(data.annotations.indexOf(a))}}>对象 {data.annotations.indexOf(a)+1}</button>)}</div></li>)}</ol>},
    {key:'clinical',label:'病例信息',children:<><p>{data.case.clinical_text??'暂无临床信息'}</p><p>确诊方式：{data.case.confirm_method}</p><p>疾病标签：{data.disease?.name??'缺失，不能通过审核'}</p><p>来源：{data.case.source}</p></>},
    {key:'attachments',label:'附件',children:result?<p>审核已结束，附件预览已关闭。</p>:<AttachmentPreview context="reviews" token={session.token} caseId={data.case.id} attachments={data.attachments} onExpired={onExpired}/>},
   ]}/>} right={<div className="readonly-panel">
    {Object.entries(checkNames).map(([key,label])=><div key={key}><label>{label}<Select aria-label={label} disabled={readOnly} placeholder="请选择" value={checks[key as keyof typeof checkNames]} options={[{value:true,label:'合格 / 完整 / 正确'},{value:false,label:'不合格 / 缺失 / 错误'}]} onChange={value=>setChecks(old=>({...old,[key]:value}))}/></label></div>)}
    <p>三项全部合格方可通过；打回至少填写一条可执行意见。请勿在批注中填写患者身份信息。</p>
    <ul className="readonly-object-list">{data.annotations.map((a,i)=><li key={a.id} style={{borderLeftColor:objectColor(i)}}><Button disabled={readOnly} onClick={()=>select(a.id)}>对象 {i+1} · {toolNames[a.tool]}</Button><Checkbox checked={!hidden.has(a.id)} onChange={()=>setHidden(old=>{const next=new Set(old);next.has(a.id)?next.delete(a.id):next.add(a.id);return next;})}>显示对象 {i+1}</Checkbox><Input.TextArea aria-label={`对象 ${i+1} 审核意见`} disabled={readOnly} value={notes[a.id]??''} onChange={e=>setNotes(old=>({...old,[a.id]:e.target.value}))}/></li>)}</ul>
    {selectedObject&&<><p>对象只读属性：部位 {dictionary?.tree.flatMap(root=>root.children).find(n=>n.id===selectedObject.part_id)?.name??selectedObject.part_id??'未填写'}；代表帧 {selectedObject.key_frame_index+1}，范围 {selectedObject.frame_start+1}–{selectedObject.frame_end+1}，置信度 {selectedObject.confidence==='typical'?'典型':selectedObject.confidence==='atypical'?'不典型':'未填写'}，报告关联 {selectedObject.report_sent_ids.join(', ')}，窗预设 {selectedObject.window_preset??'无'}</p><ul>{selectedObject.sign_tag_ids.map(id=>{const sign=dictionary?.sign_tags.find(s=>s.id===id);return <li key={id}>{sign?.name??id}：{sign?.definition??'规范暂不可用'}</li>;})}</ul></>}
    <Input.TextArea aria-label="总体审核意见" disabled={readOnly} value={overall} onChange={e=>setOverall(e.target.value)} placeholder="总体意见"/>
    <Space><Button type="primary" disabled={readOnly||!canPass} onClick={()=>setConfirm('通过')}>审核通过</Button><Button danger disabled={readOnly||!complete||comments.length<2} onClick={()=>setConfirm('打回')}>{quality?'打回并下线':'打回重标'}</Button></Space>
   </div>}>{series?<><ViewerToolbar tool={tool} windowDrag={windowDrag} onTool={value=>{setTool(value as 'pan'|'select'|'zoom'|'measure');setWindowDrag(false);}} onWindowDrag={()=>{setTool('pan');setWindowDrag(true);}} calibrated={!!geometry?.row_spacing&&!!geometry?.column_spacing} disabled={readOnly} window={window} modality={series.modality} onWindow={value=>{setWindow(value);}}/>
 <SeriesNavigation series={data.series} selected={series} frame={frame} window={window} disabled={readOnly} annotatedFrames={data.annotations.filter(a=>a.series_id===seriesId).map(a=>({frame:a.key_frame_index,color:objectColor(data.annotations.indexOf(a)),number:data.annotations.indexOf(a)+1}))} onFrame={setFrame} onSeries={id=>{const next=data.series.find(s=>s.id===id)!;setSeriesId(id);setFrame(0);setWindow(next.default_window);setTool('pan');setWindowDrag(true);}}/>
 <div className="viewport-stage" onWheel={e=>{if(!readOnly&&Math.abs(e.deltaY)>0)setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(e.deltaY>0?1:-1))));}}>
      <FramePane key={`${seriesId}:${frame}:${JSON.stringify(window)}`} token={session.token} data={data} series={series} frame={frame} window={window} onGeometry={setGeometry} onExpired={onExpired} windowDrag={windowDrag&&!readOnly} onWindow={value=>{if(!readOnly){setWindow(value);}}} layer={{colorIds:[...new Set([...data.annotations,...(comparison??[])].map(a=>a.id))],annotations:data.annotations.filter(a=>a.series_id===seriesId),comparison:comparison?.filter(a=>a.series_id===seriesId),selected,hidden,locked:new Set(data.annotations.map(a=>a.id)),tool,diameter:1,erase:false,freehand:false,disabled:readOnly,onSelect:select,onCreate:()=>{},onChange:()=>{}}}/>
     </div><footer className="viewer-status"><span>标注只读 · 滚轮翻层 · 中键平移 · 右键缩放</span><span>{data.annotations.length} 个对象</span></footer>
 </>:<Empty description="暂无可阅片序列"/>}</WorkspaceLayout>
  <Modal title={quality?(confirm==='通过'?`确认${qualityName}通过`:'确认打回并下线'):confirm==='通过'?'确认通过并发布':'确认打回重标'} open={!!confirm} onCancel={()=>{if(!busy)setConfirm(undefined);}} footer={<Space><Button disabled={busy} onClick={()=>setConfirm(undefined)}>取消</Button><Button loading={busy} disabled={busy} onClick={()=>void decide()}>确认{confirm==='通过'?'发布':'打回'}</Button></Space>}>
   <p>{quality?(confirm==='通过'?'通过后病例继续发布，金标准保持锁定。':`打回后该病例立即下线，旧金标准保留。${data.review_kind==='spotcheck'?'同时触发本轮同标注人其他候选病例的全面复核。':'本次全面复核失败不再扩大范围。'}`):confirm==='通过'?'通过后病例立即发布，当前版本锁定为金标准；继续修改前必须先下线。':'打回意见将保存，病例返回重标；原人员不能承接时退至待分配。'}</p><p>检查：{Object.entries(checkNames).map(([key,name])=>`${name}：${checks[key as keyof typeof checkNames]?'合格':'不合格'}`).join('；')}</p><p>对象批注 {comments.filter(c=>c.kind==='object').length} 条；总体意见：{overall||'无'}</p>
  </Modal>
 </section>;
}
