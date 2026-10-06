import { Alert,Button,Checkbox,Empty,InputNumber,Select,Space,Spin,Tabs,Typography } from 'antd';
import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import { libraryApi } from '../library/api';
import type { LibraryData } from '../library/types';
import { toolNames } from '../annotations/AnnotationPanel';
import { viewerApi,ViewerRequestError,type FrameGeometry,type FrameWindow } from '../viewer/api';
import { AttachmentPreview } from '../viewer/AttachmentPreview';
import { FramePane } from './WorkbenchPage';
export function LibraryCasePage({session,onExpired}:{session:Session;onExpired?():void}){
 const {caseId=''}=useParams(),[data,setData]=useState<LibraryData>(),[error,setError]=useState<string>(),[retry,setRetry]=useState(0);
 useEffect(()=>{let stopped=false,version:number|undefined,busy=false;const controller=new AbortController();setData(undefined);setError(undefined);
  const read=async()=>{if(stopped||busy)return;busy=true;try{const next=await libraryApi.read(caseId,session.token,controller.signal);if(stopped)return;if(version!==undefined&&next.version!==version)throw new Error('已发布版本已变化，请重新打开病例');if(version===undefined){version=next.version;setData(next);}}catch(e){if(!stopped){stopped=true;setData(undefined);viewerApi.clearPreloads(session.token,caseId);setError(e instanceof Error?e.message:'病例不可访问');if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}}finally{busy=false;}};
  void read();const interval=setInterval(()=>void read(),30_000);const focus=()=>void read();globalThis.addEventListener('focus',focus);
  return()=>{stopped=true;controller.abort();clearInterval(interval);globalThis.removeEventListener('focus',focus);viewerApi.clearPreloads(session.token,caseId);};
 },[caseId,session.token,retry]);
 const denied=()=>{setData(undefined);setError('影像或附件已不可访问，请重新打开病例');viewerApi.clearPreloads(session.token,caseId);};
 if(error)return <Alert type="error" message={error} action={<Space><Button onClick={()=>setRetry(n=>n+1)}>重新打开病例</Button><Link to="/library">返回病例库</Link></Space>}/>;
 if(!data||data.case.id!==caseId)return <Spin tip="读取已发布病例"><div/></Spin>;
 return <LibraryContent key={`${caseId}:${data.version}:${retry}`} data={data} session={session} onExpired={onExpired} onDenied={denied}/>;
}
function LibraryContent({data,session,onExpired,onDenied}:{data:LibraryData;session:Session;onExpired?():void;onDenied():void}){
 const first=data.annotations[0],initial=data.series.find(s=>s.id===first?.series_id)??data.series[0];
 const [seriesId,setSeriesId]=useState(initial?.id??''),[frame,setFrame]=useState(first?.key_frame_index??0),[window,setWindow]=useState<FrameWindow|null>(initial?.default_window??null),[center,setCenter]=useState<number|null>(window?.center??null),[width,setWidth]=useState<number|null>(window?.width??null),[geometry,setGeometry]=useState<FrameGeometry>();
 const [focus,setFocus]=useState(false),[windowDrag,setWindowDrag]=useState(false),[selected,setSelected]=useState<string>(),[hidden,setHidden]=useState(new Set<string>()),[tool,setTool]=useState<'pan'|'select'|'measure'>('pan');
 const series=data.series.find(s=>s.id===seriesId),object=data.annotations.find(a=>a.id===selected);
 const apply=(value:FrameWindow)=>{setWindow(value);setCenter(value.center);setWidth(value.width);};
 const select=(id:string)=>{const a=data.annotations.find(a=>a.id===id);if(!a)return;setSelected(id);setSeriesId(a.series_id);setFrame(a.key_frame_index);if(a.series_id!==seriesId){const s=data.series.find(s=>s.id===a.series_id);setWindow(s?.default_window??null);setCenter(s?.default_window?.center??null);setWidth(s?.default_window?.width??null);}document.getElementById(`library-report-${a.report_sent_ids[0]}`)?.scrollIntoView?.({block:'nearest'});};
 return <section className="workbench" aria-label="病例库只读详情" tabIndex={0} onKeyDown={e=>{if((e.target as HTMLElement).closest('input,textarea,[role=combobox]'))return;if(e.key==='Escape')setFocus(false);if(series&&['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){e.preventDefault();setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1))));}}}>
 <Space className="workbench-heading"><Typography.Title level={3}>{data.case.case_no}</Typography.Title><span>已发布 · 金标准版本 {data.version} · 只读</span><Button onClick={()=>setFocus(!focus)}>{focus?'退出专注模式':'影像专注模式'}</Button><Link to="/library">返回病例库</Link></Space>
 <div className={`workbench-columns${focus?' is-focused':''}`}>
 {!focus&&<aside><Tabs items={[{key:'report',label:'报告',children:<ol className="workbench-report">{data.sentences.map(s=><li key={s.idx} id={`library-report-${s.idx}`} data-linked={object?.report_sent_ids.includes(s.idx)} style={{background:object?.report_sent_ids.includes(s.idx)?'#164c63':undefined}}>[{s.idx}] {s.text}</li>)}</ol>},{key:'clinical',label:'病例信息',children:<><p>{data.case.clinical_text??'暂无临床信息'}</p><p>疾病：{data.disease?.name??'暂无'}</p><p>确诊方式：{data.case.confirm_method}</p><p>年龄段：{data.case.age_band} · 性别：{data.case.sex}</p><p>来源：合成数据</p></>},{key:'attachments',label:'附件',children:<AttachmentPreview context="library" version={data.version} token={session.token} caseId={data.case.id} attachments={data.attachments} onExpired={onExpired} onDenied={onDenied}/>},{key:'teaching',label:'教学字段',children:data.teaching_fields?<dl>{Object.entries(data.teaching_fields).map(([k,v])=><div key={k}><dt>{({difficulty:'难度',applicable_level:'适用学段',sign_points:'征象要点'} as Record<string,string>)[k]??k}</dt><dd>{typeof v==='string'?v:JSON.stringify(v)}</dd></div>)}</dl>:<p>暂无教学字段</p>}]}/></aside>}
 <main className="workbench-center">{series?<>
 <Select aria-label="影像序列" value={seriesId} options={data.series.map((s,i)=>({value:s.id,label:`序列 ${i+1} · ${s.modality} · ${s.frame_count} 帧`}))} onChange={id=>{const s=data.series.find(s=>s.id===id)!;setSeriesId(id);setFrame(0);setWindow(s.default_window);setCenter(s.default_window?.center??null);setWidth(s.default_window?.width??null);}}/>
 <Space wrap><Button disabled={frame===0} onClick={()=>setFrame(n=>n-1)}>上一帧</Button><span>第 {frame+1} / {series.frame_count} 帧</span><Button disabled={frame===series.frame_count-1} onClick={()=>setFrame(n=>n+1)}>下一帧</Button><InputNumber aria-label="窗位" value={center} onChange={setCenter}/><InputNumber aria-label="窗宽" value={width} onChange={setWidth}/><Button disabled={center===null||width===null||width<=0} onClick={()=>apply({center:center!,width:width!})}>应用窗设置</Button></Space>
 <Space><Button onClick={()=>{setWindowDrag(!windowDrag);setTool('pan');}}>拖拽调窗</Button><Button onClick={()=>{setWindowDrag(false);setTool('pan');}}>平移</Button><Button onClick={()=>{setWindowDrag(false);setTool('select');}}>选择只读对象</Button><Button disabled={!geometry?.row_spacing||!geometry?.column_spacing} onClick={()=>{setWindowDrag(false);setTool('measure');}}>测量</Button></Space>
 <div onWheel={e=>{if(e.deltaY)setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+(e.deltaY>0?1:-1))));}}><FramePane key={`${seriesId}:${frame}:${JSON.stringify(window)}`} data={data} token={session.token} series={series} frame={frame} window={window} libraryVersion={data.version} onGeometry={setGeometry} onExpired={onExpired} onDenied={onDenied} windowDrag={windowDrag} onWindow={apply} layer={{annotations:data.annotations.filter(a=>a.series_id===seriesId),selected,hidden,locked:new Set(data.annotations.map(a=>a.id)),tool,diameter:1,erase:false,freehand:false,disabled:false,onSelect:select,onCreate:()=>{},onChange:()=>{}}}/></div>
 </>:<Empty description="暂无可阅片序列"/>}</main>
 {!focus&&<aside><Typography.Title level={4}>金标准对象</Typography.Title><ul>{data.annotations.map((a,i)=><li key={a.id}><Button onClick={()=>select(a.id)}>对象 {i+1} · {toolNames[a.tool]}</Button><Checkbox checked={!hidden.has(a.id)} onChange={()=>setHidden(old=>{const next=new Set(old);next.has(a.id)?next.delete(a.id):next.add(a.id);return next;})}>显示对象 {i+1}</Checkbox></li>)}</ul>{object&&<p>代表帧 {object.key_frame_index+1}；范围 {object.frame_start+1}–{object.frame_end+1}；置信度 {object.confidence??'未填写'}；关联报告 {object.report_sent_ids.join(', ')}；窗预设 {object.window_preset??'无'}</p>}<p>对象与标签已锁定为金标准。</p></aside>}
 </div></section>;
}
