import { Alert,Button,InputNumber,Modal,Space,Table } from 'antd';
import { useEffect,useRef,useState } from 'react';
import { AnnotationRequestError,annotationsApi } from './api';
import type { Annotation,AnnotationRead } from './types';
import { toolNames } from './AnnotationPanel';
function describe(a?:Annotation):string {
 if(!a)return '不存在';
 const g=a.geometry;
 const shape=a.tool==='point'?`(${(g as {x:number}).x.toFixed(2)}, ${(g as {y:number}).y.toFixed(2)})`:a.tool==='box'?`${(g as {w:number}).w.toFixed(2)} × ${(g as {h:number}).h.toFixed(2)} 像素`:a.tool==='polygon'?`${(g as {points:number[][]}).points.length} 个顶点`:`${(g as {rle:readonly number[]}).rle.reduce((n,run,i)=>n+(i%2?run:0),0)} 个掩膜像素`;
 return `${toolNames[a.tool]} · ${shape} · 第 ${a.frame_start+1}–${a.frame_end+1} 帧`;
}
export function HistoryPanel({caseId,token,version,current,onPreview,onExpired}:{caseId:string;token:string;version:number;current:Annotation[];onPreview(value:AnnotationRead):void;onExpired?():void}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(0),[result,setResult]=useState<AnnotationRead>(),[error,setError]=useState<string>(),[busy,setBusy]=useState(false),controller=useRef<AbortController>();
 useEffect(()=>()=>controller.current?.abort(),[]);
 const load=async()=>{controller.current?.abort();const next=new AbortController();controller.current=next;setBusy(true);setError(undefined);setResult(undefined);try{const data=await annotationsApi.read(caseId,token,next.signal,selected);if(!next.signal.aborted)setResult(data);}catch(e){if(!next.signal.aborted){setError(e instanceof Error?e.message:'历史读取失败');if(e instanceof AnnotationRequestError&&e.status===401)onExpired?.();}}finally{if(!next.signal.aborted)setBusy(false);}};
 const ids=[...new Set([...(result?.annotations??[]),...current].map(a=>a.id))];
 return <><Button onClick={()=>{setOpen(true);setSelected(Math.max(0,version-1));}}>版本历史</Button><Modal title="标注版本比较" width={900} open={open} onCancel={()=>{controller.current?.abort();setBusy(false);setOpen(false);}} footer={<Button disabled={!result} onClick={()=>{if(result)onPreview(result);setOpen(false);}}>在影像上查看历史轮廓</Button>}>
 <Space><span>历史版本</span><InputNumber aria-label="历史标注版本" min={0} max={version} value={selected} onChange={v=>{if(v!==null&&Number.isInteger(v))setSelected(v);}}/><Button loading={busy} onClick={()=>void load()}>读取并比较</Button><span>当前版本 {version}</span></Space>
 {error&&<Alert type="error" message={error}/>}<Table pagination={false} rowKey="id" dataSource={result?ids.map((id,i)=>({id,number:i+1,old:result.annotations.find(a=>a.id===id),now:current.find(a=>a.id===id)})):[]} columns={[{title:'对象',dataIndex:'number'},{title:'历史轮廓',render:(_,r)=>describe(r.old)},{title:'当前轮廓',render:(_,r)=>describe(r.now)},{title:'变化',render:(_,r)=>!r.old?'新增':!r.now?'删除':JSON.stringify(r.old.geometry)!==JSON.stringify(r.now.geometry)?'几何有变化':JSON.stringify({...r.old,version:undefined,is_gold:undefined})!==JSON.stringify({...r.now,version:undefined,is_gold:undefined})?'属性或关联有变化':'一致'}]}/>
 </Modal></>;
}
