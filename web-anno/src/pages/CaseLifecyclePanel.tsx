import {Alert,Button,Modal,Space} from 'antd';
import {useEffect,useRef,useState} from 'react';
import type {CaseDetail} from '../cases/detail-api';
import {casesLifecycleApi,LifecycleRequestError,type LifecycleResult} from '../cases/lifecycle-api';
export function CaseLifecyclePanel({detail,token,onChanged,onDenied,onReload}:{detail:CaseDetail;token:string;onChanged(value:LifecycleResult):void;onDenied(message:string):void;onReload():Promise<void>}){
 const [confirm,setConfirm]=useState<{action:'offline'|'reactivate';version:number}>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[needsReload,setNeedsReload]=useState(false),[online,setOnline]=useState(navigator.onLine);
 const pending=useRef(false),controller=useRef<AbortController>();
 useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);
  return()=>{controller.current?.abort();window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};
 },[detail.id,token]);
 const available=detail.source==='synthetic'&&Number.isInteger(detail.annotation_version)&&['已发布','已下线'].includes(detail.status);
 const action=detail.status==='已发布'?'offline':'reactivate';
 const submit=async()=>{
  if(pending.current||!confirm||!online||needsReload)return;
  pending.current=true;setBusy(true);setError(undefined);const next=new AbortController();controller.current=next;
  try{const value=await casesLifecycleApi.change(token,detail.id,confirm.version,confirm.action,next.signal);if(!next.signal.aborted){setConfirm(undefined);onChanged(value);}}
  catch(e){if(!next.signal.aborted){setConfirm(undefined);const message=e instanceof Error?e.message:'病例操作失败';
   if(e instanceof LifecycleRequestError&&(e.status===401||e.status===403)){onDenied(message);return;}
   setError(message);setNeedsReload(true);
  }}finally{if(!next.signal.aborted){pending.current=false;setBusy(false);}}
 };
 const reload=async()=>{if(pending.current)return;pending.current=true;setBusy(true);try{await onReload();setError(undefined);setNeedsReload(false);}catch(e){setError(e instanceof Error?e.message:'病例重新读取失败');}finally{pending.current=false;setBusy(false);}};
 return <Space direction="vertical">
  {!online&&<Alert type="warning" message="当前离线，恢复网络后才能变更病例状态"/>}
  {error&&<Alert type="error" message={error} action={<Button disabled={busy} onClick={()=>void reload()}>重新读取病例</Button>}/>}
  {available&&<Button danger={action==='offline'} disabled={busy||needsReload||!online} onClick={()=>setConfirm({action,version:detail.annotation_version})}>{action==='offline'?'下线病例':'重新启用病例'}</Button>}
  <Modal title={confirm?.action==='offline'?'确认下线病例':'确认重新启用病例'} open={!!confirm} closable={!busy} maskClosable={!busy} onCancel={()=>{if(!busy)setConfirm(undefined);}}
   footer={<Space><Button disabled={busy} onClick={()=>setConfirm(undefined)}>取消</Button><Button danger={confirm?.action==='offline'} loading={busy} disabled={busy||!online} onClick={()=>void submit()}>{confirm?.action==='offline'?'确认下线':'确认重新启用'}</Button></Space>}>
   {confirm?.action==='offline'?<p>下线后停止使用该病例，旧金标准及审核历史保留。需要修改时，请重新启用并重走标注审核流程。</p>:<p>保留旧金标准，复制为下一版本的重标起点；病例回到原任务待分配，并按原模式分发。原任务不可用时将拒绝操作。</p>}
   <p>病例号：{detail.case_no}；当前版本：{confirm?.version}</p>
  </Modal>
 </Space>;
}
