import { EducationLeaveGuard } from './navigation-guard';
import { Alert, Button, Empty, Popconfirm, Space, Spin, Switch, Modal, Tag } from 'antd';
import { useContext, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import type { Annotation, Geometry, PointGeometry } from '../annotations/types';
import type { DrawingTool } from '../annotations/drawing';
import { pointsOnFrame, pointFrames } from '../annotations/point-marks';
import { frameMask } from '../annotations/drawing';
import { StudentReport } from './StudentReport';
import { LesionCard } from './LesionCard';
import { LesionRecord } from './LesionRecord';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { FramePane } from '../pages/WorkbenchPage';
import { WorkspaceLayout } from '../viewer/WorkspaceLayout';
import { SeriesNavigation, ViewerToolbar } from '../viewer/ViewerToolbar';
import { viewerApi, type FrameGeometry, type FrameWindow } from '../viewer/api';
import { isTextInput, objectColor, toolDefinitions } from '../viewer/workspaceConfig';
import { educationApi, EducationError } from './api';
import type { EducationFeedback, EducationWorkbench, StudentAnswer, StudentObject } from './types';
const message=(e:unknown)=>e instanceof Error?e.message:'操作失败';
export function StudentWorkbenchPage({session,onExpired,feedback=false}:{session:Session;onExpired():void;feedback?:boolean}){
 const {attemptId=''}=useParams(),[data,setData]=useState<EducationWorkbench|EducationFeedback>(),[error,setError]=useState(''),[reload,setReload]=useState(0);const route=useNavigate();
 useEffect(()=>{const c=new AbortController();setData(undefined);setError('');const timeout=setTimeout(()=>{c.abort();setError('加载超时，请重试');},30000);
 (feedback?educationApi.feedback(session.token,attemptId,c.signal):educationApi.workbench(session.token,attemptId,c.signal)).then(v=>{if(c.signal.aborted)return;if(v.attempt.id!==attemptId)throw new Error('返回作答与当前题目不一致');if(!feedback&&v.attempt.state==='submitted'){route(`/student/attempts/${attemptId}/feedback`,{replace:true});return;}setData(v);}).catch(e=>{if(!c.signal.aborted){setError(message(e));if(e instanceof EducationError&&e.status===401)onExpired();}}).finally(()=>clearTimeout(timeout));
 return()=>{c.abort();clearTimeout(timeout);};},[attemptId,session.token,feedback,reload]);
 if(error)return <Alert type="error" message={error} action={<Space><Button onClick={()=>setReload(n=>n+1)}>重新加载</Button><Link to="/student">返回我的考核</Link></Space>}/>;
 if(!data)return <Spin tip="加载考核工作台"><div style={{height:200}}/></Spin>;
 return <StudentWorkspace key={`${attemptId}:${session.token}:${feedback}:${reload}`} session={session} data={data} feedback={feedback} onExpired={onExpired} onReload={()=>setReload(n=>n+1)}/>;
}
function StudentWorkspace({session,data,feedback,onExpired,onReload}:{session:Session;data:EducationWorkbench|EducationFeedback;feedback:boolean;onExpired():void;onReload():void}){
 const route=useNavigate(),initialObject=data.attempt.answer.objects[0],first=data.series.find(s=>s.id===initialObject?.series_id)??data.series[0],id=data.attempt.id;
 const [answer,setAnswer]=useState<StudentAnswer>(data.attempt.answer),[status,setStatus]=useState('已保存'),[error,setError]=useState(''),[blocked,setBlocked]=useState(false),[submitting,setSubmitting]=useState(false),[offline,setOffline]=useState(!navigator.onLine);
 const leaveGuard=useContext(EducationLeaveGuard);
 const current=useRef(answer),saved=useRef(JSON.stringify(answer)),version=useRef(data.attempt.version),pending=useRef<Promise<void>>(),submitPending=useRef(false),mounted=useRef(true),denied=useRef(false);
 const [seriesId,setSeriesId]=useState(first?.id??''),[frame,setFrame]=useState(initialObject?.key_frame_index??0),[window,setWindow]=useState<FrameWindow|null>(first?.default_window??null),[geometry,setGeometry]=useState<FrameGeometry>();
 const [tool,setTool]=useState<DrawingTool>('pan'),[windowDrag,setWindowDrag]=useState(true),[diameter,setDiameter]=useState(10),[erase,setErase]=useState(false),[freehand,setFreehand]=useState(false),[opacity,setOpacity]=useState(70),[focus,setFocus]=useState(false);
 const [selected,setSelected]=useState<string|undefined>(initialObject?.id),[hidden,setHidden]=useState(new Set<string>()),[locked,setLocked]=useState(new Set<string>()),[showStandard,setShowStandard]=useState(true);
 const [creating,setCreating]=useState(false), lastDrawing=useRef<Annotation['tool']>('box');
 const undo=useRef<StudentAnswer[]>([]),redo=useRef<StudentAnswer[]>([]);
 const editable=!feedback&&!blocked&&!submitting&&data.task.status==='published';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;viewerApi.clearPreloads(session.token,data.item.case_id);};},[]);
 useEffect(()=>{const online=()=>setOffline(!navigator.onLine),unload=(e:BeforeUnloadEvent)=>{if(!feedback&&JSON.stringify(current.current)!==saved.current){e.preventDefault();e.returnValue='';}};addEventListener('online',online);addEventListener('offline',online);addEventListener('beforeunload',unload);return()=>{removeEventListener('online',online);removeEventListener('offline',online);removeEventListener('beforeunload',unload);};},[]);
 const fail=(e:unknown)=>{if(!mounted.current)return;setError(message(e));setStatus('保存失败');if(e instanceof EducationError&&[401,403,409].includes(e.status)){denied.current=true;setBlocked(true);if(e.status===401)onExpired();}};
 const save=():Promise<void>=>{
  if(pending.current)return pending.current;
  if(JSON.stringify(current.current)===saved.current)return Promise.resolve();
  if(feedback||denied.current)return Promise.reject(new Error('当前作答不可保存，请重新加载'));
  if(!navigator.onLine)return Promise.reject(new Error('离线中，尚未保存到服务器'));
  const work=(async()=>{while(mounted.current&&JSON.stringify(current.current)!==saved.current){const snapshot=structuredClone(current.current),payload=JSON.stringify(snapshot);setStatus('保存中');const r=await educationApi.save(session.token,id,version.current,snapshot);version.current=r.version;saved.current=payload;if(mounted.current){setStatus('已保存');setError('');}}})();
  pending.current=work.finally(()=>{pending.current=undefined;});return pending.current;
 };
 useEffect(()=>{if(!editable||offline||error)return;const timer=setTimeout(()=>{void save().catch(fail);},900);return()=>clearTimeout(timer);},[answer,offline,editable,error]);
 const change=(next:StudentAnswer,history=true)=>{if(!editable||submitPending.current)return;if(history){undo.current.push(structuredClone(current.current));if(undo.current.length>30)undo.current.shift();redo.current=[];}current.current=next;setAnswer(next);setStatus('尚未保存');};
 const objects=answer.objects,object=objects.find(o=>o.id===selected),series=data.series.find(s=>s.id===seriesId);
 const travel=(back:boolean)=>{if(!editable)return;const from=back?undo:redo,to=back?redo:undo,next=from.current.pop();if(next){to.current.push(structuredClone(current.current));change(next,false);}};
 const modify=(patch:Partial<StudentObject>)=>{if(object&&!locked.has(object.id))change({...answer,objects:objects.map(o=>o.id===object.id?{...o,...patch}:o)});};
 const remove=(oid:string)=>{
  if(!editable||locked.has(oid))return;
  change({...answer,objects:objects.filter(o=>o.id!==oid)});
  if(oid===selected){setSelected(undefined);chooseTool('select');}
 };
 const chooseTool=(next:DrawingTool)=>{
  setTool(next);setWindowDrag(false);
  const drawing=toolDefinitions.find(t=>t.id===next);
  if(drawing)lastDrawing.current=drawing.id;
  else setCreating(false);
 };
 const pickTool=(next:DrawingTool)=>{
  if(next==='point' && tool==='point' && !windowDrag){chooseTool('select');return;}
  chooseTool(next);
 };
 const startLesion=()=>{
  setSelected(undefined);setCreating(true);setErase(false);
  chooseTool(lastDrawing.current==='brush'&&!(geometry?.row_spacing&&geometry.column_spacing)?'box':lastDrawing.current);
 };
 const selectOnImage=(oid:string)=>{setSelected(oid);chooseTool('select');};
 const select=(oid:string)=>{
  const o=objects.find(o=>o.id===oid);if(!o)return;
  selectOnImage(oid);
  if(o.series_id!==seriesId)setWindow(data.series.find(s=>s.id===o.series_id)?.default_window??null);
  setSeriesId(o.series_id);setFrame(o.key_frame_index);
 };
 const create=(kind:Annotation['tool'],shape:Geometry)=>{
  if(!editable||!series)return;
  if(kind==='point'&&!creating&&object?.tool==='point'&&object.series_id===series.id){
   if(locked.has(object.id)||hidden.has(object.id))return;
   const geometry=object.geometry as PointGeometry;
   const {x,y}=shape as PointGeometry;
   modify({geometry:{...geometry,additional_points:[...(geometry.additional_points??[]),{frame_index:frame,x,y}]},
    frame_start:Math.min(frame,object.frame_start),frame_end:Math.max(frame,object.frame_end)});
   return;
  }
  const next:StudentObject={id:crypto.randomUUID(),series_id:series.id,tool:kind,geometry:shape,
   frame_start:frame,frame_end:frame,key_frame_index:frame,window_preset:series.modality==='CT'?JSON.stringify(window??series.default_window):null,
   part_id:null,confidence:null,sign_tag_ids:[],report_sent_ids:[],organ:'',description:''};
  change({...answer,objects:[...objects,next]});setSelected(next.id);setCreating(false);
  if(kind!=='brush'&&kind!=='point')chooseTool('select');
 };
 const canCopy=!!object&&object.series_id===seriesId&&!!series&&frame+1<series.frame_count&&frame>=object.frame_start&&frame<=object.frame_end
  &&(object.tool!=='brush'||!!frameMask(object,frame))&&(object.tool!=='point'||pointsOnFrame(object,frame).length>0);
 const copyToNext=()=>{
  if(!editable||!object||locked.has(object.id)||!canCopy)return;
  const nextFrame=frame+1;
  let shape=structuredClone(object.geometry);
  if(object.tool==='point'){
   const [first,...rest]=pointsOnFrame(object,frame);
   shape={x:first.x,y:first.y,...(rest.length?{additional_points:rest.map(p=>({x:p.x,y:p.y,frame_index:nextFrame}))}:{})};
  }
  if(object.tool==='brush'){
   const mask=frameMask(object,frame)!;
   shape={width:mask.width,height:mask.height,rle:[...mask.rle]};
  }
  const next={...structuredClone(object),id:crypto.randomUUID(),geometry:shape,frame_start:nextFrame,frame_end:nextFrame,key_frame_index:nextFrame};
  change({...answer,objects:[...objects,next]});setSelected(next.id);setFrame(nextFrame);chooseTool('select');
 };
 const blocker=useBlocker(({currentLocation,nextLocation})=>!feedback&&currentLocation.pathname!==nextLocation.pathname&&(!!pending.current||JSON.stringify(current.current)!==saved.current));
 useEffect(()=>{if(feedback)return;leaveGuard.current=async()=>{try{await save();return true;}catch(e){fail(e);return false;}};return()=>{leaveGuard.current=null;};});
 const leaveSaved=async()=>{try{await save();if(blocker.state==='blocked')blocker.proceed();}catch(e){fail(e);}};
 const submit=async()=>{if(submitPending.current||!editable)return;submitPending.current=true;setSubmitting(true);setError('');try{await save();await educationApi.submit(session.token,id,version.current);route(`/student/attempts/${id}/feedback`,{replace:true});}catch(e){fail(e);}finally{submitPending.current=false;if(mounted.current)setSubmitting(false);}};
 const toggle=(setter:typeof setHidden,oid:string)=>setter(old=>{const next=new Set(old);next.has(oid)?next.delete(oid):next.add(oid);return next;});
 const reportReady=!!(answer.body_part_id&&answer.findings.trim()&&answer.impression.trim());
 const incomplete=objects.findIndex(o=>!o.organ.trim()||!o.description.trim());
 const missing=!objects.length?'请先在影像上标注病灶':incomplete>=0?`请补全病灶 ${incomplete+1} 的器官 / 位置和病变描述`:!reportReady?'请填写身体部位、影像所见和诊断意见':'';
 const standard=feedback&&'reference'in data?data.reference:undefined;
 const pointTarget=!creating&&object?.tool==='point'?object:undefined;
 const pointHint=pointTarget
  ? locked.has(pointTarget.id)?'当前病灶已锁定，请解锁或新增病灶'
  : hidden.has(pointTarget.id)?'当前病灶已隐藏，请显示轮廓或新增病灶'
  : `正在为病灶 ${objects.indexOf(pointTarget)+1} 加点`
  : '点击影像标记第一个点';
 const frameDenied=(e:unknown)=>{setError(message(e));setBlocked(true);denied.current=true;};
 return <section className="workbench education-workbench" tabIndex={0} onKeyDown={e=>{if(isTextInput(e.target))return;if(e.key==='Escape'){setFocus(false);chooseTool('pan');setWindowDrag(true);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(editable)void save().catch(fail);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();travel(!e.shiftKey);}if((e.key==='Delete'||(e.key==='Backspace'&&tool!=='polygon'))&&selected&&editable){e.preventDefault();remove(selected);}if(!e.ctrlKey&&!e.metaKey&&!e.altKey){if(editable&&['1','2','3','4'].includes(e.key)){const next=({1:'box',2:'brush',3:'polygon',4:'point'} as const)[e.key as '1'|'2'|'3'|'4'];if(next!=='brush'||(geometry?.row_spacing&&geometry.column_spacing)){pickTool(next);}}if(e.key.toLowerCase()==='w'){chooseTool('pan');setWindowDrag(true);}if(['p','z','m'].includes(e.key.toLowerCase())){const next=({p:'pan',z:'zoom',m:'measure'} as const)[e.key.toLowerCase() as 'p'|'z'|'m'];if(next!=='measure'||(geometry?.row_spacing&&geometry.column_spacing)){chooseTool(next);}}if(editable&&['[',']'].includes(e.key))setDiameter(n=>Math.max(.1,n+(e.key===']'?1:-1)));}if(['ArrowDown','ArrowUp'].includes(e.key)&&series){e.preventDefault();setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(e.key==='ArrowDown'?1:-1))));}}}>
 <Modal title="作答尚未保存" open={blocker.state==='blocked'} onCancel={()=>{if(blocker.state==='blocked')blocker.reset();}} footer={<Space><Button onClick={()=>{if(blocker.state==='blocked')blocker.reset();}}>继续作答</Button><Button danger onClick={()=>{saved.current=JSON.stringify(current.current);if(blocker.state==='blocked')blocker.proceed();}}>放弃未保存修改</Button><Button type="primary" disabled={offline||blocked} onClick={()=>void leaveSaved()}>保存后离开</Button></Space>}><p>当前输入尚未全部同步到服务器，请保存后离开。</p>{error&&<Alert type="error" message={error}/>}</Modal>
 {offline&&<Alert type="warning" message="离线中，修改尚未同步；请保持本页打开并恢复网络"/>}{error&&<Alert type="error" message={error} action={blocked?<Popconfirm title="重新加载将丢弃尚未保存的修改，继续？" onConfirm={onReload}><Button>重新加载</Button></Popconfirm>:<Button onClick={()=>{setError('');void save().catch(fail);}}>重试保存</Button>}/>}
 <WorkspaceLayout identity={<>
   <Link className="student-home-link" to="/student" aria-label="返回学生主页" title="返回学生主页"><ViewerIcon name="home"/></Link>
   <strong className="student-task-identity" title={data.task.title}>{data.task.title}</strong>
   <span className="student-question-number">第 {data.item.ordinal} 题</span><Tag color={feedback?'green':'blue'}>{feedback?'提交后对照':'独立作答'}</Tag>
 </>}
  leftTitle={feedback?'报告对照':'我的阅片报告'} rightTitle={`我的病灶（${objects.length}）`} focus={focus} onFocus={setFocus}
  actions={feedback?<Space><span>已提交 · {data.attempt.submitted_at&&new Date(data.attempt.submitted_at).toLocaleString()}</span>{standard?.annotations.length?<Switch aria-label="显示医生参考标注" checked={showStandard} onChange={setShowStandard} checkedChildren="标准轮廓开" unCheckedChildren="标准轮廓关"/>:null}</Space>:<Space><span className="draft-status" role="status" data-saved={status==='已保存'&&!offline}>{offline?'离线':status}</span><Button disabled={!editable||offline} onClick={()=>void save().catch(fail)}>保存</Button><Popconfirm title={missing||'提交后将锁定作答并开放医生参考报告。确认提交？'} onConfirm={missing?undefined:submit} okText={missing?'知道了':'确认提交'} showCancel={!missing} disabled={!editable||offline}><Button type="primary" loading={submitting} disabled={!editable||offline}>提交作答</Button></Popconfirm></Space>}
  toolbar={series?<ViewerToolbar tool={tool} windowDrag={windowDrag} onTool={pickTool} onWindowDrag={()=>{chooseTool('pan');setWindowDrag(true);}} drawing={!feedback} editable={editable} calibrated={!!geometry?.row_spacing&&!!geometry.column_spacing} window={window} modality={series.modality} onWindow={setWindow} diameter={diameter} onDiameter={setDiameter} erase={erase} onErase={setErase} freehand={freehand} onFreehand={setFreehand} canUndo={editable&&!!undo.current.length} canRedo={editable&&!!redo.current.length} onUndo={()=>travel(true)} onRedo={()=>travel(false)} opacity={opacity} onOpacity={setOpacity}/>:null}
  left={<StudentReport answer={answer} parts={data.parts} instructions={data.task.instructions} reference={standard} editable={editable} onChange={change}/>}
  right={<div className="education-form">
    {!feedback&&<button type="button" className="add-lesion" disabled={!editable||!series} onClick={startLesion}><ViewerIcon name="plus"/>新增病灶</button>}
    {!feedback&&tool==='point'&&!windowDrag&&<p role="status" className="point-mode-hint"><ViewerIcon name="point"/><span>{pointHint}<small>再次点击点工具结束，新增病灶可另起一组。</small></span></p>}
    {creating&&tool!=='point'&&<p role="status" className="education-instructions">在影像上用{toolDefinitions.find(t=>t.id===tool)?.label}绘制新病灶。</p>}
    {objects.length===0&&!creating&&tool!=='point'&&<p className="education-instructions">{feedback?'该答卷没有标注对象。':'点击“新增病灶”开始标注。每个病灶单独填写位置和描述。'}</p>}
    {!!objects.length&&<ul className="education-object-list" aria-label="病灶列表">{objects.map((o,i)=><LesionCard key={o.id}
      object={o} index={i} selected={o.id===selected} locked={locked.has(o.id)} hidden={hidden.has(o.id)} feedback={feedback} editable={editable}
      onSelect={()=>select(o.id)} onHide={()=>{if(o.id===selected&&!hidden.has(o.id))chooseTool('select');toggle(setHidden,o.id);}}
      onLock={()=>{if(o.id===selected&&!locked.has(o.id))chooseTool('select');toggle(setLocked,o.id);}} onDelete={()=>remove(o.id)}/>)}</ul>}
    {object&&<LesionRecord key={object.id} object={object} number={objects.indexOf(object)+1} data={data} feedback={feedback}
      editable={editable&&!locked.has(object.id)} canCopy={canCopy} onChange={modify} onCopy={copyToNext}/>}
  </div>}>
  {series?<><div className="viewport-stage" onWheel={e=>{if(e.deltaY&&series.frame_count>1)setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(e.deltaY>0?1:-1))));}}><SeriesNavigation series={data.series} selected={series} frame={frame} onFrame={setFrame} annotatedFrames={objects.flatMap((o,i)=>o.series_id!==seriesId?[]:(o.tool==='point'?pointFrames(o):[o.key_frame_index]).map(frame=>({frame,color:objectColor(i),number:i+1})))} onSeries={sid=>{setSelected(undefined);chooseTool('select');setSeriesId(sid);setFrame(0);setWindow(data.series.find(s=>s.id===sid)?.default_window??null);}}/>
  <FramePane token={session.token} data={{case:{id:data.item.case_id}}} series={series} frame={frame} window={window} libraryVersion={{attempt_id:id}} onGeometry={setGeometry} onExpired={onExpired} onDenied={frameDenied} windowDrag={windowDrag} onWindow={setWindow} layer={{annotations:objects.filter(o=>o.series_id===seriesId),comparison:!blocked&&showStandard?standard?.annotations.filter(o=>o.series_id===seriesId):undefined,comparisonColor:'#77DAC2',colorIds:objects.map(o=>o.id),selected,hidden,locked,tool,diameter,erase,freehand,opacity:opacity/100,createNew:creating||(editable&&tool==='point'&&!windowDrag),disabled:!editable,onSelect:selectOnImage,onDelete:remove,onCreate:create,onChange:(oid,g)=>change({...answer,objects:objects.map(o=>o.id===oid?{...o,geometry:g}:o)})}}/></div><footer className="viewer-status">{feedback?<span className="overlay-legend"><i/>我的标注{showStandard&&!!standard?.annotations.length&&<><i className="doctor-line"/>医生参考</>}</span>:<span>滚轮翻层 · 中键平移</span>}<span>{objects.length} 个对象</span></footer></>:<Empty description="暂无可阅片序列"/>}
 </WorkspaceLayout></section>;
}
