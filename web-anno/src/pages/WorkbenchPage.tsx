import { Alert, Button, Empty, Space, Spin, Tabs, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link,useNavigate,useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import { ViewerRequestError, viewerApi, type FrameGeometry, type FrameWindow, type Series, type Workbench } from '../viewer/api';
import { AnnotationLayer } from '../annotations/AnnotationLayer';
import { AnnotationPanel } from '../annotations/AnnotationPanel';
import { AttachmentPreview } from '../viewer/AttachmentPreview';
import { SaveIndicator } from '../annotations/SaveIndicator';
import { annotationsApi, AnnotationRequestError, type SubmissionIssues } from '../annotations/api';
import { useAnnotations } from '../annotations/useAnnotations';
import { HistoryPanel } from '../annotations/HistoryPanel';
import { ReviewFeedback } from '../reviews/ReviewFeedback';
import type { AnnotationRead } from '../annotations/types';
import type { Annotation, Geometry } from '../annotations/types';
import type { DrawingTool } from '../annotations/drawing';
import { rankReportCandidates } from '../annotations/report-candidates';
import { taxonomyApi } from '../taxonomy/api';
import type { TaxonomyTreeResponse } from '../taxonomy/types';
import { CaseDetails, WorkspaceLayout } from '../viewer/WorkspaceLayout';
import { SeriesNavigation, ViewerToolbar } from '../viewer/ViewerToolbar';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { ViewerPageState } from '../viewer/ViewerPageState';
import { isTextInput, objectColor } from '../viewer/workspaceConfig';
const message = (e: unknown) => e instanceof Error ? e.message : '工作台加载失败';
export function FramePane({ token, data, series, frame, window, layer, onGeometry, onExpired, windowDrag, onWindow, libraryVersion, onDenied }: { token:string; data:Workbench; series:Series; frame:number; window:FrameWindow|null; layer:Omit<Parameters<typeof AnnotationLayer>[0],'controls'|'frame'>; onGeometry(value:FrameGeometry):void;onExpired?():void;windowDrag:boolean;onWindow(value:FrameWindow):void;libraryVersion?:number;onDenied?(e:unknown):void }) {
  const element=useRef<HTMLDivElement>(null), controls=useRef<Awaited<ReturnType<typeof import('../viewer/cornerstone').mountFrame>>>();
  const [active,setActive]=useState<Awaited<ReturnType<typeof import('../viewer/cornerstone').mountFrame>>>();
  const [candidate,setCandidate]=useState<FrameWindow>();
  useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){pointer.current=undefined;setCandidate(undefined);}};globalThis.addEventListener('keydown',cancel);return()=>globalThis.removeEventListener('keydown',cancel);},[]);
  const [error,setError]=useState<string>(), [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    import('../viewer/cornerstone').then(module=>controller.signal.aborted ? undefined : (libraryVersion===undefined?module.mountFrame(element.current!,token,data.case.id,series,frame,window,controller.signal):module.mountFrame(element.current!,token,data.case.id,series,frame,window,controller.signal,libraryVersion)))
      .then(value=>{if(!controller.signal.aborted){controls.current=value;setActive(value);if(value)onGeometry(value.geometry);setLoading(false);}})
      .catch(e=>{if(!controller.signal.aborted){setError(message(e));setLoading(false);if(libraryVersion!==undefined&&e instanceof ViewerRequestError&&[401,403,409,429,502].includes(e.status))onDenied?.(e);if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});
    return ()=>{controller.abort();controls.current?.dispose();controls.current=undefined;};
  },[token,data,series,frame,window,libraryVersion]);
  const pointer = useRef<{x:number;y:number;kind:'pan'|'zoom'|'window';window:FrameWindow}>();
  const space = useRef(false);
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if(isTextInput(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();space.current=true;}if(e.key.toLowerCase()==='r')controls.current?.reset();};
    const up=(e:KeyboardEvent)=>{if(e.code==='Space')space.current=false;};
    const blur=()=>{space.current=false;pointer.current=undefined;};
    globalThis.addEventListener('keydown',down);globalThis.addEventListener('keyup',up);globalThis.addEventListener('blur',blur);
    return()=>{globalThis.removeEventListener('keydown',down);globalThis.removeEventListener('keyup',up);globalThis.removeEventListener('blur',blur);};
  },[]);
  return <div className="frame-pane" onContextMenu={e=>e.preventDefault()}
    onPointerDownCapture={e=>{if(loading||error||(e.target as HTMLElement).closest('button,input'))return;const kind=e.button===2?'zoom':e.button===1||space.current?'pan':e.button===0?(windowDrag?'window':layer.tool==='zoom'?'zoom':undefined):undefined;if(!kind)return;e.preventDefault();e.stopPropagation();pointer.current={x:e.clientX,y:e.clientY,kind,window:window??{center:128,width:256}};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMoveCapture={e=>{const p=pointer.current;if(!p)return;e.stopPropagation();const dx=e.clientX-p.x,dy=e.clientY-p.y;if(p.kind==='window')setCandidate({center:Math.round(p.window.center+dy),width:Math.max(1,Math.round(p.window.width+dx))});else{if(p.kind==='zoom')controls.current?.zoom(Math.exp(-dy/200));else controls.current?.pan(dx,dy);p.x=e.clientX;p.y=e.clientY;}}}
    onPointerUpCapture={e=>{const p=pointer.current;if(!p)return;e.stopPropagation();pointer.current=undefined;if(p.kind==='window')onWindow({center:Math.round(p.window.center+e.clientY-p.y),width:Math.max(1,Math.round(p.window.width+e.clientX-p.x))});setCandidate(undefined);}}
    onPointerCancel={()=>{pointer.current=undefined;setCandidate(undefined);}}>
    <div className="viewport-actions"><Button type="text" aria-label="放大" title="放大" icon={<ViewerIcon name="zoom"/>} disabled={loading||!!error} onClick={()=>controls.current?.zoom(1.2)}/><Button type="text" aria-label="缩小" title="缩小" icon={<ViewerIcon name="zoomOut"/>} disabled={loading||!!error} onClick={()=>controls.current?.zoom(1/1.2)}/><Button type="text" aria-label="重置视图" title="重置视图 · R" icon={<ViewerIcon name="reset"/>} disabled={loading||!!error} onClick={()=>controls.current?.reset()}/></div>
    <div className="viewport-overlay viewport-overlay-bottom"><span>{candidate?`待应用 WL ${candidate.center} / WW ${candidate.width}`:`WL ${window?.center??'默认'} / WW ${window?.width??'默认'}`}</span><span>{frame+1} / {series.frame_count}</span></div>
    {error&&<div className="viewport-feedback"><Alert type="error" message={error}/></div>}{loading&&<div className="viewport-feedback"><Spin tip="加载安全帧"><div/></Spin></div>}
    <div className="frame-canvas" data-frame-ready={active?frame:undefined}><div ref={element} aria-label="影像视口" className="workbench-viewport"/>
    {active&&<AnnotationLayer {...layer} disabled={layer.disabled||windowDrag||layer.tool==='zoom'} controls={active} frame={frame}/>}</div>
  </div>;
}
export function WorkbenchPage({ session,onExpired }: { session:Session;onExpired?:()=>void }) {
  const {caseId=''}=useParams(); const [data,setData]=useState<Workbench>(),[error,setError]=useState<string>(),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(undefined);setError(undefined);
    const timeout=setTimeout(()=>{controller.abort();setError('工作台加载超时，请检查网络后重试');},30_000);
    viewerApi.workbench(caseId,session.token,controller.signal).then(value=>{if(controller.signal.aborted)return;if(value?.case?.id!==caseId)throw new Error('工作台返回的病例与当前任务不一致，请重试或返回任务列表');setData(value);})
      .catch(e=>{if(!controller.signal.aborted){setError(message(e));if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}})
      .finally(()=>clearTimeout(timeout));
    return ()=>{clearTimeout(timeout);controller.abort();viewerApi.clearPreloads(session.token,caseId);};
  },[caseId,session.token,retry]);
  if(error)return <ViewerPageState><Alert type="error" showIcon message={error} action={<Space wrap><Button onClick={()=>setRetry(n=>n+1)}>重试加载</Button><Link to="/tasks">返回任务列表</Link></Space>}/></ViewerPageState>;
  if(!data || data.case.id !== caseId)return <ViewerPageState loading="加载工作台"/>;
  return <WorkbenchContent key={`${caseId}:${session.token}`} session={session} data={data} onExpired={onExpired}/>;
}
function WorkbenchContent({session,data,onExpired}:{session:Session;data:Workbench;onExpired?:()=>void}){
  const caseId=data.case.id;
  const [seriesId,setSeriesId]=useState(''),[frame,setFrame]=useState(0),[window,setWindow]=useState<FrameWindow|null>(null);
  const [focus,setFocus]=useState(false),[opacity,setOpacity]=useState(100);
  const {state,latestReview,engine,editable:canEdit}=useAnnotations(session,caseId,data.case.source,onExpired);
  const [history,setHistory]=useState<AnnotationRead>();
  const [submitting,setSubmitting]=useState(false),[submitError,setSubmitError]=useState<string>(),[issues,setIssues]=useState<SubmissionIssues>();
  const submitPending=useRef(false),route=useNavigate();
  const submitController=useRef<AbortController>();
  useEffect(()=>()=>submitController.current?.abort(),[]);
  const editable=canEdit&&!history&&!submitting,displayAnnotations=history?.annotations??state.annotations;
  const [windowDrag,setWindowDrag]=useState(true);
  const [tool,updateTool]=useState<DrawingTool>('pan'),[diameter,setDiameter]=useState(5),[erase,setErase]=useState(false),[freehand,setFreehand]=useState(false);
  const setTool:typeof updateTool=value=>{setWindowDrag(false);updateTool(value);};
  const [selected,setSelected]=useState<string>(),[hidden,setHidden]=useState(new Set<string>()),[locked,setLocked]=useState(new Set<string>());
  const [dictionary,setDictionary]=useState<TaxonomyTreeResponse>(),[dictionaryError,setDictionaryError]=useState<string>(),[geometry,setGeometry]=useState<FrameGeometry>();
  useEffect(()=>{if(!geometry?.row_spacing||!geometry?.column_spacing)updateTool(current=>current==='brush'||current==='measure'?'pan':current);},[geometry]);
  const undo=useRef<Annotation[][]>([]),redo=useRef<Annotation[][]>([]);
  const [,setHistoryTick]=useState(0);
  useEffect(()=>{const first=data.series[0];setSeriesId(first?.id??'');setWindow(first?.default_window??null);},[data]);
  useEffect(()=>{let live=true;taxonomyApi.tree(session.token).then(value=>{if(live)setDictionary(value);}).catch(e=>{if(live)setDictionaryError(message(e));});return()=>{live=false;};},[session.token]);
  const change=(items:Annotation[])=>{if(!editable)return;undo.current.push(structuredClone(state.annotations));redo.current=[];setHistoryTick(n=>n+1);engine.current?.change(items);};
  const select=(id:string)=>{setSelected(id);const a=displayAnnotations.find(a=>a.id===id);if(a){if(a.series_id!==seriesId)setWindow(data.series.find(s=>s.id===a.series_id)?.default_window??null);setSeriesId(a.series_id);setFrame(a.key_frame_index);document.getElementById(`report-sentence-${a.report_sent_ids[0]}`)?.scrollIntoView?.({block:'nearest'});}};
  const objectIds=useRef<string[]>([]);
  for(const a of [...state.annotations,...displayAnnotations])if(!objectIds.current.includes(a.id))objectIds.current.push(a.id);
  const objectIndex=(id:string)=>objectIds.current.indexOf(id);
  const selectedObject=displayAnnotations.find(a=>a.id===selected);
  const part=dictionary?.tree.flatMap(root=>root.children).find(n=>n.id===selectedObject?.part_id);
  const keywords=[part?.name??'',...(part?.synonyms??[]),...(dictionary?.sign_tags.filter(s=>selectedObject?.sign_tag_ids.includes(s.id)).map(s=>s.name)??[])];
  const candidates=rankReportCandidates(data.sentences,keywords);
  const toggle=(setter:typeof setHidden,id:string)=>setter(old=>{const next=new Set(old);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const create=(kind:Annotation['tool'],shape:Geometry)=>{
    if(!editable||!series)return;const id=crypto.randomUUID();
    const a:Annotation={id,series_id:series.id,tool:kind,geometry:shape,frame_start:frame,frame_end:frame,key_frame_index:frame,window_preset:series.modality==='CT'?JSON.stringify(window??series.default_window):null,part_id:null,sign_tag_ids:[],confidence:null,report_sent_ids:[]};
    change([...state.annotations,a]);setSelected(id);
  };
  const travel=(back:boolean)=>{if(!editable)return;const from=back?undo:redo,to=back?redo:undo;const next=from.current.pop();if(next){to.current.push(structuredClone(state.annotations));engine.current?.change(next);setHistoryTick(n=>n+1);}};
  const series=data.series.find(s=>s.id===seriesId);
  const navigate=(delta:number)=>{if(series)setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+delta)));};
  const submit=async()=>{
    if(submitPending.current||!engine.current||!editable||!navigator.onLine)return;
    submitPending.current=true;setSubmitting(true);setSubmitError(undefined);setIssues(undefined);
    const controller=new AbortController();submitController.current=controller;
    try{
      await engine.current.saveNow();
      const saved=engine.current.snapshot();
      if(controller.signal.aborted)return;
      if(saved.dirty||saved.checking||!saved.initialized||saved.status!=='saved')throw new Error('请先恢复网络并处理保存错误或版本冲突');
      await annotationsApi.submit(caseId,session.token,controller.signal,saved.version);
      await engine.current.dispose();route('/tasks');
    }catch(error){
      if(controller.signal.aborted)return;
      setSubmitError(message(error));
      if(error instanceof AnnotationRequestError){setIssues(error.issues);if(error.status===401){await engine.current?.dispose();onExpired?.();}}
    }finally{if(!controller.signal.aborted){submitPending.current=false;setSubmitting(false);}}
  };
  return <section className="workbench" tabIndex={0} onKeyDown={e=>{
    if(isTextInput(e.target))return;
    if(e.key==='Escape'){setFocus(false);setTool('pan');setWindowDrag(true);}
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&['1','2','3','4'].includes(e.key)&&editable){const next=({1:'box',2:'brush',3:'polygon',4:'point'} as const)[e.key as '1'|'2'|'3'|'4'];if(next!=='brush'||(geometry?.row_spacing&&geometry?.column_spacing))setTool(next);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&editable){e.preventDefault();travel(!e.shiftKey);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(editable)void engine.current?.saveNow();}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(editable&&selected&&!locked.has(selected)&&(e.key==='Delete'||(e.key==='Backspace'&&tool!=='polygon'))){e.preventDefault();change(state.annotations.filter(a=>a.id!==selected));setSelected(undefined);}
    if(e.key.toLowerCase()==='z')setTool('zoom');
    if(e.key.toLowerCase()==='w'){setTool('pan');setWindowDrag(true);}if(e.key.toLowerCase()==='p')setTool('pan');if(e.key.toLowerCase()==='m'&&geometry?.row_spacing&&geometry?.column_spacing)setTool('measure');
    if(editable&&['[',']'].includes(e.key))setDiameter(n=>Math.max(.1,n+(e.key===']'?1:-1)));
    if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();navigate(e.key==='ArrowDown'?1:-1);}
  }}>

    <ReviewFeedback review={latestReview} annotations={state.annotations} onSelect={select}/>
    {submitError&&<Alert type="error" message={submitError} description={<>{issues?.objects.map(item=><div key={item.id}><Button type="link" onClick={()=>select(item.id)}>对象 {objectIndex(item.id)+1}</Button>：{item.fields.map(field=>({part_id:'部位',sign_tag_ids:'征象',confidence:'置信度',report_sent_ids:'报告关联'})[field as 'part_id']).join('、')}未完成</div>)}{issues?.sentence_ids.map(id=><div key={id}>报告 [{id}]：{data.sentences.find(s=>s.idx===id)?.text} 尚未关联</div>)}</>}/>}
    {dictionaryError&&<Alert type="error" message={dictionaryError}/>}{history&&<Alert type="info" message={`正在查看历史版本 ${history.version}，轮廓只读`} action={<Button onClick={()=>{setHistory(undefined);setSelected(undefined);}}>返回当前标注</Button>}/>}
    <WorkspaceLayout identity={<><CaseDetails data={data}/><Tag color="blue">{data.case.status}</Tag></>} actions={<>
      <SaveIndicator compact disabled={submitting} state={state} engine={engine.current} onAdopt={()=>{undo.current=[];redo.current=[];setSelected(undefined);setHistoryTick(n=>n+1);}}/>
      <HistoryPanel caseId={caseId} token={session.token} version={state.version} current={state.annotations} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}} onPreview={value=>{setHistory(value);setSelected(undefined);setTool('pan');}}/>
      <Button type="primary" loading={submitting} disabled={!editable||['offline','conflict','blocked','loading','error'].includes(state.status)} onClick={()=>void submit()}>提交审核</Button>
    </>} toolbar={series ? <ViewerToolbar tool={tool} windowDrag={windowDrag} onTool={setTool} onWindowDrag={()=>{setTool('pan');setWindowDrag(true);}} drawing editable={editable} calibrated={!!geometry?.row_spacing&&!!geometry?.column_spacing} window={window} modality={series.modality} onWindow={setWindow} diameter={diameter} onDiameter={setDiameter} erase={erase} onErase={setErase} freehand={freehand} onFreehand={setFreehand} canUndo={!!undo.current.length} canRedo={!!redo.current.length} onUndo={()=>travel(true)} onRedo={()=>travel(false)} opacity={opacity} onOpacity={setOpacity}/> : null} focus={focus} onFocus={setFocus} left={<Tabs defaultActiveKey="report" items={[
      {key:'report',label:'报告',children:data.sentences.length?<><p className="panel-hint">{selectedObject?'点击句子关联当前对象，再次点击取消':'选择对象后可关联报告句'}</p><ol className="workbench-report">{data.sentences.map(sentence=>{const linked=selectedObject?.report_sent_ids.includes(sentence.idx),candidate=candidates.some(c=>c.idx===sentence.idx);return <li id={`report-sentence-${sentence.idx}`} key={sentence.idx} data-linked={!!linked} data-candidate={candidate&&!linked} style={{borderLeftColor:linked?objectColor(objectIndex(selected??'')):undefined}}><button type="button" className="report-sentence" disabled={!selectedObject||!editable||locked.has(selectedObject.id)} onClick={()=>{if(selectedObject){const ids=selectedObject.report_sent_ids.filter(v=>v!==-1);change(state.annotations.map(a=>a.id===selectedObject.id?{...a,report_sent_ids:ids.includes(sentence.idx)?ids.filter(v=>v!==sentence.idx):[...ids,sentence.idx]}:a));}}}><span className="sentence-number">{`[${sentence.idx}]`}</span><span>{sentence.text}</span></button>{candidate&&!linked&&<span className="candidate-label">候选</span>}<div className="report-object-links">{displayAnnotations.filter(a=>a.report_sent_ids.includes(sentence.idx)).map(a=><button type="button" key={a.id} onClick={()=>select(a.id)} style={{color:objectColor(objectIndex(a.id))}}>对象 {objectIndex(a.id)+1}</button>)}</div></li>;})}</ol></>:<Empty description="暂无报告"/>},
      {key:'clinical',label:'临床',children:<><p>{data.case.age_band||'年龄未填写'} · {data.case.sex||'性别未填写'}</p><p>{data.case.clinical_text||'暂无临床信息'}</p><p>{data.case.confirm_method}</p></>},
      {key:'attachments',label:'附件',children:<AttachmentPreview token={session.token} caseId={caseId} attachments={data.attachments} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}}/>},
    ]}/>} right={<AnnotationPanel colorIds={objectIds.current} annotations={displayAnnotations} selected={selected} dictionary={dictionary} system={data.case.system_code} series={data.series} frame={frame} disabled={!editable} hidden={hidden} locked={locked} onSelect={select} onChange={change} onHidden={id=>toggle(setHidden,id)} onLocked={id=>toggle(setLocked,id)} onFrame={setFrame}/> }>
      {series?<>
      <div className="viewport-stage" onWheel={e=>{if(series.frame_count>1&&e.deltaY)navigate(e.deltaY>0?1:-1);}}><SeriesNavigation series={data.series} selected={series} frame={frame} onFrame={setFrame} annotatedFrames={displayAnnotations.filter(a=>a.series_id===seriesId).map(a=>({frame:a.key_frame_index,color:objectColor(objectIndex(a.id)),number:objectIndex(a.id)+1}))} onSeries={id=>{const next=data.series.find(s=>s.id===id)!;setSeriesId(id);setFrame(0);setWindow(next.default_window);setTool('pan');setWindowDrag(true);}}/>
      <FramePane key={`${caseId}:${seriesId}:${frame}:${JSON.stringify(window)}:${session.token}`} token={session.token} data={data} series={series} frame={frame} window={window} onGeometry={setGeometry} windowDrag={windowDrag} onWindow={setWindow} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}} layer={{annotations:displayAnnotations.filter(a=>a.series_id===seriesId),colorIds:objectIds.current,opacity:opacity/100,selected,hidden,locked:history?new Set(displayAnnotations.map(a=>a.id)):locked,tool,diameter,erase,freehand,disabled:!editable&&!history,onSelect:select,onCreate:create,onChange:(id,shape)=>change(state.annotations.map(a=>a.id===id?{...a,geometry:shape}:a))}}/></div>
      <footer className="viewer-status"><span>{history?'历史只读':editable?'标注模式':'标注只读'} · 滚轮翻层 · 中键平移 · 右键缩放</span><span>{geometry&&(!geometry.row_spacing||!geometry.column_spacing)?'缺少像素间距，毫米画笔和测量不可用':`${displayAnnotations.length} 个对象`}</span></footer>
      </>:<Empty description="病例暂无可阅片序列"/>}
    </WorkspaceLayout>
  </section>;
}
