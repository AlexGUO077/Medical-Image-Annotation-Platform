import { Alert, Button, Checkbox, Empty, InputNumber, Select, Space, Spin, Tabs, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import { ViewerRequestError, viewerApi, type FrameGeometry, type FrameWindow, type Series, type Workbench } from '../viewer/api';
import { AnnotationLayer } from '../annotations/AnnotationLayer';
import { AnnotationPanel, toolNames } from '../annotations/AnnotationPanel';
import { AttachmentPreview } from '../viewer/AttachmentPreview';
import { SaveIndicator } from '../annotations/SaveIndicator';
import { annotationsApi, AnnotationRequestError, type SubmissionIssues } from '../annotations/api';
import { useAnnotations } from '../annotations/useAnnotations';
import { HistoryPanel } from '../annotations/HistoryPanel';
import type { AnnotationRead } from '../annotations/types';
import type { Annotation, Geometry } from '../annotations/types';
import type { DrawingTool } from '../annotations/drawing';
import { rankReportCandidates } from '../annotations/report-candidates';
import { taxonomyApi } from '../taxonomy/api';
import type { TaxonomyTreeResponse } from '../taxonomy/types';
const message = (e: unknown) => e instanceof Error ? e.message : '工作台加载失败';
function FramePane({ token, data, series, frame, window, layer, onGeometry, onExpired, windowDrag, onWindow }: { token:string; data:Workbench; series:Series; frame:number; window:FrameWindow|null; layer:Omit<Parameters<typeof AnnotationLayer>[0],'controls'|'frame'>; onGeometry(value:FrameGeometry):void;onExpired?():void;windowDrag:boolean;onWindow(value:FrameWindow):void }) {
  const element=useRef<HTMLDivElement>(null), controls=useRef<Awaited<ReturnType<typeof import('../viewer/cornerstone').mountFrame>>>();
  const [active,setActive]=useState<Awaited<ReturnType<typeof import('../viewer/cornerstone').mountFrame>>>();
  const drag=useRef<{x:number;y:number;window:FrameWindow}>();
  const [candidate,setCandidate]=useState<FrameWindow>();
  useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){drag.current=undefined;setCandidate(undefined);}};globalThis.addEventListener('keydown',cancel);return()=>globalThis.removeEventListener('keydown',cancel);},[]);
  const [error,setError]=useState<string>(), [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    import('../viewer/cornerstone').then(module=>controller.signal.aborted ? undefined : module.mountFrame(element.current!,token,data.case.id,series,frame,window,controller.signal))
      .then(value=>{if(!controller.signal.aborted){controls.current=value;setActive(value);if(value)onGeometry(value.geometry);setLoading(false);}})
      .catch(e=>{if(!controller.signal.aborted){setError(message(e));setLoading(false);if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});
    return ()=>{controller.abort();controls.current?.dispose();controls.current=undefined;};
  },[token,data,series,frame,window]);
  return <>
    <Space><Button disabled={loading||!!error} onClick={()=>controls.current?.zoom(1.2)}>放大</Button><Button disabled={loading||!!error} onClick={()=>controls.current?.zoom(1/1.2)}>缩小</Button><Button disabled={loading||!!error} onClick={()=>controls.current?.reset()}>重置视图</Button><span>拖动平移</span></Space>
    {candidate&&<span>待应用 WL {candidate.center} / WW {candidate.width}</span>}{error&&<Alert type="error" message={error} />}{loading&&<Spin tip="加载安全帧"><div /></Spin>}
    <div style={{position:'relative'}} data-frame-ready={active?frame:undefined}><div ref={element} aria-label="影像视口" className="workbench-viewport" onContextMenu={e=>e.preventDefault()}
      onPointerDown={e=>{if(e.button!==0||loading||error)return;drag.current={x:e.clientX,y:e.clientY,window:window??{center:128,width:256}};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!drag.current)return;if(windowDrag){setCandidate({center:Math.round(drag.current.window.center+e.clientY-drag.current.y),width:Math.max(1,Math.round(drag.current.window.width+e.clientX-drag.current.x))});}else{controls.current?.pan(e.clientX-drag.current.x,e.clientY-drag.current.y);drag.current={...drag.current,x:e.clientX,y:e.clientY};}}}
      onPointerUp={e=>{const start=drag.current;drag.current=undefined;setCandidate(undefined);if(windowDrag&&start)onWindow({center:Math.round(start.window.center+e.clientY-start.y),width:Math.max(1,Math.round(start.window.width+e.clientX-start.x))});}} onPointerCancel={()=>{drag.current=undefined;setCandidate(undefined);}} />
    {active&&<AnnotationLayer {...layer} disabled={layer.disabled||windowDrag} controls={active} frame={frame}/>}</div>
  </>;
}
export function WorkbenchPage({ session,onExpired }: { session:Session;onExpired?:()=>void }) {
  const {caseId=''}=useParams(); const [data,setData]=useState<Workbench>(),[error,setError]=useState<string>();
  useEffect(()=>{
    const controller=new AbortController();setData(undefined);setError(undefined);
    viewerApi.workbench(caseId,session.token,controller.signal).then(value=>{if(controller.signal.aborted)return;setData(value);})
      .catch(e=>{if(!controller.signal.aborted){setError(message(e));if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});return ()=>{controller.abort();viewerApi.clearPreloads(session.token,caseId);};
  },[caseId,session.token]);
  if(error)return <Alert type="error" message={error}/>;
  if(!data || data.case.id !== caseId)return <Spin tip="加载工作台"><div/></Spin>;
  return <WorkbenchContent key={`${caseId}:${session.token}`} session={session} data={data} onExpired={onExpired}/>;
}
function WorkbenchContent({session,data,onExpired}:{session:Session;data:Workbench;onExpired?:()=>void}){
  const caseId=data.case.id;
  const [seriesId,setSeriesId]=useState(''),[frame,setFrame]=useState(0),[window,setWindow]=useState<FrameWindow|null>(null);
  const [center,setCenter]=useState<number|null>(null),[width,setWidth]=useState<number|null>(null),[focus,setFocus]=useState(false);
  const {state,engine,editable:canEdit}=useAnnotations(session,caseId,data.case.source,onExpired);
  const [history,setHistory]=useState<AnnotationRead>();
  const [submitting,setSubmitting]=useState(false),[submitError,setSubmitError]=useState<string>(),[issues,setIssues]=useState<SubmissionIssues>();
  const submitPending=useRef(false),route=useNavigate();
  const submitController=useRef<AbortController>();
  useEffect(()=>()=>submitController.current?.abort(),[]);
  const editable=canEdit&&!history&&!submitting,displayAnnotations=history?.annotations??state.annotations;
  const [windowDrag,setWindowDrag]=useState(false);
  const [tool,updateTool]=useState<DrawingTool>('pan'),[diameter,setDiameter]=useState(5),[erase,setErase]=useState(false),[freehand,setFreehand]=useState(false);
  const setTool:typeof updateTool=value=>{setWindowDrag(false);updateTool(value);};
  const [selected,setSelected]=useState<string>(),[hidden,setHidden]=useState(new Set<string>()),[locked,setLocked]=useState(new Set<string>());
  const [dictionary,setDictionary]=useState<TaxonomyTreeResponse>(),[dictionaryError,setDictionaryError]=useState<string>(),[geometry,setGeometry]=useState<FrameGeometry>();
  useEffect(()=>{if(!geometry?.row_spacing||!geometry?.column_spacing)updateTool(current=>current==='brush'||current==='measure'?'pan':current);},[geometry]);
  const undo=useRef<Annotation[][]>([]),redo=useRef<Annotation[][]>([]);
  const [,setHistoryTick]=useState(0);
  useEffect(()=>{const first=data.series[0];setSeriesId(first?.id??'');setWindow(first?.default_window??null);setCenter(first?.default_window?.center??null);setWidth(first?.default_window?.width??null);},[data]);
  useEffect(()=>{let live=true;taxonomyApi.tree(session.token).then(value=>{if(live)setDictionary(value);}).catch(e=>{if(live)setDictionaryError(message(e));});return()=>{live=false;};},[session.token]);
  const change=(items:Annotation[])=>{if(!editable)return;undo.current.push(structuredClone(state.annotations));redo.current=[];setHistoryTick(n=>n+1);engine.current?.change(items);};
  const select=(id:string)=>{setSelected(id);const a=displayAnnotations.find(a=>a.id===id);if(a){setSeriesId(a.series_id);setFrame(a.key_frame_index);document.getElementById(`report-sentence-${a.report_sent_ids[0]}`)?.scrollIntoView?.({block:'nearest'});}};
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
  const travel=(back:boolean)=>{const from=back?undo:redo,to=back?redo:undo;const next=from.current.pop();if(next){to.current.push(structuredClone(state.annotations));engine.current?.change(next);setHistoryTick(n=>n+1);}};
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
  return <section className="workbench" tabIndex={0} onKeyDown={e=>{if((e.target as HTMLElement).matches('input,textarea,[role=combobox]'))return;if(e.key==='Escape')setFocus(false);if(['1','2','3','4'].includes(e.key)&&editable){const next=({1:'box',2:'brush',3:'polygon',4:'point'} as const)[e.key as '1'|'2'|'3'|'4'];if(next!=='brush'||(geometry?.row_spacing&&geometry?.column_spacing))setTool(next);}if((e.ctrlKey||e.metaKey)&&e.key==='z'&&editable){e.preventDefault();travel(!e.shiftKey);}if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){e.preventDefault();navigate(['ArrowDown','ArrowRight'].includes(e.key)?1:-1);}}}>
    <Space className="workbench-heading"><Typography.Title level={3}>{data.case.case_no}</Typography.Title><span>{data.case.status} · {data.case.system_code}</span><Button onClick={()=>setFocus(!focus)}>{focus?'退出专注模式':'影像专注模式'}</Button></Space>
    <Button type="primary" loading={submitting} disabled={!editable||['offline','conflict','blocked','loading','error'].includes(state.status)} onClick={()=>void submit()}>提交审核</Button>
    {submitError&&<Alert type="error" message={submitError} description={<>{issues?.objects.map(item=><div key={item.id}>对象 {state.annotations.findIndex(a=>a.id===item.id)+1}：{item.fields.map(field=>({part_id:'部位',sign_tag_ids:'征象',confidence:'置信度',report_sent_ids:'报告关联'})[field as 'part_id']).join('、')}未完成</div>)}{issues?.sentence_ids.map(id=><div key={id}>报告 [{id}]：{data.sentences.find(s=>s.idx===id)?.text} 尚未关联</div>)}</>}/>}
    <SaveIndicator disabled={submitting} state={state} engine={engine.current} onAdopt={()=>{undo.current=[];redo.current=[];setSelected(undefined);setHistoryTick(n=>n+1);}}/>{dictionaryError&&<Alert type="error" message={dictionaryError}/>}
    <HistoryPanel caseId={caseId} token={session.token} version={state.version} current={state.annotations} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}} onPreview={value=>{setHistory(value);setSelected(undefined);setTool('pan');}}/>{history&&<Alert type="info" message={`正在查看历史版本 ${history.version}，轮廓只读`} action={<Button onClick={()=>{setHistory(undefined);setSelected(undefined);}}>返回当前标注</Button>}/>}
    <div className={`workbench-columns${focus?' is-focused':''}`}>
      {!focus&&<aside key="context"><Tabs defaultActiveKey="report" items={[
        {key:'report',label:'报告',children:data.sentences.length?<ol className="workbench-report">{data.sentences.map(s=><li id={`report-sentence-${s.idx}`} key={s.idx} style={{background:selectedObject?.report_sent_ids.includes(s.idx)?'#d3f9d8':candidates.some(c=>c.idx===s.idx)?'#fff3bf':undefined}}><button type="button" disabled={!selectedObject||!editable||locked.has(selectedObject.id)} style={{background:'none',border:0,textAlign:'left',cursor:'pointer',padding:6}} onClick={()=>{if(selectedObject){const ids=selectedObject.report_sent_ids.filter(v=>v!==-1);change(state.annotations.map(a=>a.id===selectedObject.id?{...a,report_sent_ids:ids.includes(s.idx)?ids.filter(v=>v!==s.idx):[...ids,s.idx]}:a));}}}><b>[{s.idx}]</b> {s.text}{candidates.some(c=>c.idx===s.idx)&&<small> · 候选</small>}</button>{displayAnnotations.filter(a=>a.report_sent_ids.includes(s.idx)).map(a=><small key={a.id}> 对象 {displayAnnotations.indexOf(a)+1}</small>)}</li>)}</ol>:<Empty description="暂无报告"/>},
        {key:'clinical',label:'临床',children:<><p>{data.case.age_band||'年龄未填写'} · {data.case.sex||'性别未填写'}</p><p>{data.case.clinical_text||'暂无临床信息'}</p><p>{data.case.confirm_method}</p></>},
        {key:'attachments',label:'附件',children:<AttachmentPreview token={session.token} caseId={caseId} attachments={data.attachments} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}}/>},
      ]}/></aside>}
      <main key="viewer" className="workbench-center">
        {series?<><Select aria-label="影像序列" value={seriesId} style={{minWidth:220}} options={data.series.map((s,i)=>({value:s.id,label:`序列 ${i+1} · ${s.modality} · ${s.frame_count} 帧`}))} onChange={id=>{const next=data.series.find(s=>s.id===id)!;setSeriesId(id);setFrame(0);setWindow(next.default_window);setCenter(next.default_window?.center??null);setWidth(next.default_window?.width??null);}}/>
        <Space wrap><Button disabled={frame===0} onClick={()=>navigate(-1)}>上一帧</Button><span>第 {frame+1} / {series.frame_count} 帧</span><Button disabled={frame===series.frame_count-1} onClick={()=>navigate(1)}>下一帧</Button><span>WL {window?.center??'默认'} / WW {window?.width??'默认'}</span></Space>
        <Space wrap><InputNumber aria-label="窗位" value={center} onChange={setCenter}/><InputNumber aria-label="窗宽" value={width} onChange={setWidth}/><Button disabled={center===null||width===null||width<=0} onClick={()=>setWindow({center:center!,width:width!})}>应用窗设置</Button></Space>
        <Space wrap><Button type={windowDrag?'primary':'default'} onClick={()=>{const next=!windowDrag;setTool('pan');setWindowDrag(next);}}>拖拽调窗</Button><Button onClick={()=>setTool('pan')} type={tool==='pan'?'primary':'default'}>平移</Button><Button disabled={!editable} onClick={()=>setTool('select')} type={tool==='select'?'primary':'default'}>选择 / 调整</Button>
        {(['box','brush','polygon','point'] as const).map((kind,i)=><Button key={kind} disabled={!editable||(kind==='brush'&&(!geometry?.row_spacing||!geometry?.column_spacing))} type={tool===kind?'primary':'default'} onClick={()=>setTool(kind)}>{i+1} {toolNames[kind]}</Button>)}
        <Button disabled={!geometry?.row_spacing||!geometry?.column_spacing} onClick={()=>setTool('measure')}>测量</Button><Button disabled={!editable||!undo.current.length} onClick={()=>travel(true)}>撤销</Button><Button disabled={!editable||!redo.current.length} onClick={()=>travel(false)}>重做</Button></Space>
        {tool==='brush'&&<Space><label>直径（mm）<InputNumber aria-label="画笔直径" min={0.1} value={diameter} onChange={v=>{if(v!==null&&v>0&&Number.isFinite(v))setDiameter(v);}}/></label><Checkbox checked={erase} onChange={e=>setErase(e.target.checked)}>橡皮擦</Checkbox></Space>}
        {tool==='polygon'&&<Space><Checkbox checked={freehand} onChange={e=>setFreehand(e.target.checked)}>自由手绘</Checkbox><span>双击或 Enter 完成，Backspace 撤末点，Esc 取消</span></Space>}
        {geometry&&(!geometry.row_spacing||!geometry.column_spacing)&&<span>影像缺少像素间距，毫米画笔和测量不可用</span>}
        {series.modality==='CT'&&<Space>{[['肺窗',-600,1500],['纵隔窗',40,400],['骨窗',400,1800]].map(([name,center,width])=><Button key={name} onClick={()=>{setWindow({center:Number(center),width:Number(width)});setCenter(Number(center));setWidth(Number(width));}}>{name}</Button>)}</Space>}
        <div onWheel={e=>{if(series.frame_count>1)navigate(e.deltaY>0?1:-1);}}><FramePane key={`${caseId}:${seriesId}:${frame}:${JSON.stringify(window)}:${session.token}`} token={session.token} data={data} series={series} frame={frame} window={window} onGeometry={setGeometry} windowDrag={windowDrag} onWindow={value=>{setWindow(value);setCenter(value.center);setWidth(value.width);}} onExpired={()=>{void engine.current?.dispose().then(()=>onExpired?.());}} layer={{annotations:displayAnnotations.filter(a=>a.series_id===seriesId),selected,hidden,locked,tool,diameter,erase,freehand,disabled:!editable&&!history,onSelect:setSelected,onCreate:create,onChange:(id,shape)=>change(state.annotations.map(a=>a.id===id?{...a,geometry:shape}:a))}}/></div></>:<Empty description="病例暂无可阅片序列"/>}
      </main>
      {!focus&&<aside key="annotations"><AnnotationPanel annotations={displayAnnotations} selected={selected} dictionary={dictionary} system={data.case.system_code} series={data.series} frame={frame} disabled={!editable} hidden={hidden} locked={locked} onSelect={select} onChange={change} onHidden={id=>toggle(setHidden,id)} onLocked={id=>toggle(setLocked,id)} onFrame={setFrame}/></aside>}
    </div>
  </section>;
}
