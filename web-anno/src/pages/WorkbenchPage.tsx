import { Alert, Button, Empty, InputNumber, Select, Space, Spin, Tabs, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import { viewerApi, type FrameWindow, type Series, type Workbench } from '../viewer/api';
const message = (e: unknown) => e instanceof Error ? e.message : '工作台加载失败';
function FramePane({ token, data, series, frame, window }: { token:string; data:Workbench; series:Series; frame:number; window:FrameWindow|null }) {
  const element=useRef<HTMLDivElement>(null), controls=useRef<Awaited<ReturnType<typeof import('../viewer/cornerstone').mountFrame>>>();
  const drag=useRef<{x:number;y:number}>();
  const [error,setError]=useState<string>(), [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    import('../viewer/cornerstone').then(module=>controller.signal.aborted ? undefined : module.mountFrame(element.current!,token,data.case.id,series,frame,window,controller.signal))
      .then(value=>{if(!controller.signal.aborted){controls.current=value;setLoading(false);}})
      .catch(e=>{if(!controller.signal.aborted){setError(message(e));setLoading(false);}});
    return ()=>{controller.abort();controls.current?.dispose();controls.current=undefined;};
  },[token,data,series,frame,window]);
  return <>
    <Space><Button disabled={loading||!!error} onClick={()=>controls.current?.zoom(1.2)}>放大</Button><Button disabled={loading||!!error} onClick={()=>controls.current?.zoom(1/1.2)}>缩小</Button><Button disabled={loading||!!error} onClick={()=>controls.current?.reset()}>重置视图</Button><span>拖动平移</span></Space>
    {error&&<Alert type="error" message={error} />}{loading&&<Spin tip="加载安全帧"><div /></Spin>}
    <div ref={element} aria-label="影像视口" className="workbench-viewport" onContextMenu={e=>e.preventDefault()}
      onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!drag.current)return;controls.current?.pan(e.clientX-drag.current.x,e.clientY-drag.current.y);drag.current={x:e.clientX,y:e.clientY};}}
      onPointerUp={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}} />
  </>;
}
export function WorkbenchPage({ session }: { session:Session }) {
  const {caseId=''}=useParams(); const [data,setData]=useState<Workbench>(),[error,setError]=useState<string>();
  const [seriesId,setSeriesId]=useState(''),[frame,setFrame]=useState(0),[window,setWindow]=useState<FrameWindow|null>(null);
  const [center,setCenter]=useState<number|null>(null),[width,setWidth]=useState<number|null>(null),[focus,setFocus]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setData(undefined);setError(undefined);
    viewerApi.workbench(caseId,session.token,controller.signal).then(value=>{if(controller.signal.aborted)return;setData(value);const first=value.series[0];setSeriesId(first?.id??'');setFrame(0);setWindow(first?.default_window??null);setCenter(first?.default_window?.center??null);setWidth(first?.default_window?.width??null);})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));});return ()=>controller.abort();
  },[caseId,session.token]);
  const series=data?.series.find(s=>s.id===seriesId);
  const navigate=(delta:number)=>{if(series)setFrame(n=>Math.max(0,Math.min(series.frame_count-1,n+delta)));};
  if(error)return <Alert type="error" message={error}/>;
  if(!data || data.case.id !== caseId)return <Spin tip="加载工作台"><div/></Spin>;
  return <section className="workbench" tabIndex={0} onKeyDown={e=>{if((e.target as HTMLElement).matches('input,textarea,[role=combobox]'))return;if(e.key==='Escape')setFocus(false);if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(e.key)){e.preventDefault();navigate(['ArrowDown','ArrowRight'].includes(e.key)?1:-1);}}}>
    <Space className="workbench-heading"><Typography.Title level={3}>{data.case.case_no}</Typography.Title><span>{data.case.status} · {data.case.system_code}</span><Button onClick={()=>setFocus(!focus)}>{focus?'退出专注模式':'影像专注模式'}</Button></Space>
    <div className={`workbench-columns${focus?' is-focused':''}`}>
      {!focus&&<aside key="context"><Tabs defaultActiveKey="report" items={[
        {key:'report',label:'报告',children:data.sentences.length?<ol className="workbench-report">{data.sentences.map(s=><li key={s.idx}><b>[{s.idx}]</b> {s.text}</li>)}</ol>:<Empty description="暂无报告"/>},
        {key:'clinical',label:'临床',children:<><p>{data.case.age_band||'年龄未填写'} · {data.case.sex||'性别未填写'}</p><p>{data.case.clinical_text||'暂无临床信息'}</p><p>{data.case.confirm_method}</p></>},
        {key:'attachments',label:'附件',children:data.attachments.length?<ul>{data.attachments.map(a=><li key={a.id}>{a.filename}（{a.kind}）</li>)}</ul>:<Empty description="暂无已确认附件"/>},
      ]}/></aside>}
      <main key="viewer" className="workbench-center" onWheel={e=>{if(series&&series.frame_count>1)navigate(e.deltaY>0?1:-1);}}>
        {series?<><Select aria-label="影像序列" value={seriesId} style={{minWidth:220}} options={data.series.map((s,i)=>({value:s.id,label:`序列 ${i+1} · ${s.modality} · ${s.frame_count} 帧`}))} onChange={id=>{const next=data.series.find(s=>s.id===id)!;setSeriesId(id);setFrame(0);setWindow(next.default_window);setCenter(next.default_window?.center??null);setWidth(next.default_window?.width??null);}}/>
        <Space wrap><Button disabled={frame===0} onClick={()=>navigate(-1)}>上一帧</Button><span>第 {frame+1} / {series.frame_count} 帧</span><Button disabled={frame===series.frame_count-1} onClick={()=>navigate(1)}>下一帧</Button><span>WL {window?.center??'默认'} / WW {window?.width??'默认'}</span></Space>
        <Space wrap><InputNumber aria-label="窗位" value={center} onChange={setCenter}/><InputNumber aria-label="窗宽" value={width} onChange={setWidth}/><Button disabled={center===null||width===null||width<=0} onClick={()=>setWindow({center:center!,width:width!})}>应用窗设置</Button></Space>
        <FramePane key={`${caseId}:${seriesId}:${frame}:${JSON.stringify(window)}:${session.token}`} token={session.token} data={data} series={series} frame={frame} window={window}/></>:<Empty description="病例暂无可阅片序列"/>}
      </main>
      {!focus&&<aside key="annotations"><Typography.Title level={4}>标注对象</Typography.Title><Empty description="标注工具尚未开放"/><Typography.Text type="secondary">当前可查看病例与影像，暂不支持保存或提交标注。</Typography.Text></aside>}
    </div>
  </section>;
}
