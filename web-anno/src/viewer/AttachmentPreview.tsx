import { Alert,Button,Empty,Modal,Space,Spin } from 'antd';
import { useEffect,useState } from 'react';
import { viewerApi,ViewerRequestError,type Workbench } from './api';
export function AttachmentPreview({token,caseId,attachments,onExpired}:{token:string;caseId:string;attachments:Workbench['attachments'];onExpired?():void}){
 const [selected,setSelected]=useState<Workbench['attachments'][number]>(),[page,setPage]=useState(1),[count,setCount]=useState(1),[url,setUrl]=useState<string>(),[error,setError]=useState<string>();
 useEffect(()=>{
  const controller=new AbortController();let objectUrl:string|undefined;setUrl(undefined);setError(undefined);
  if(selected)viewerApi.attachment(token,caseId,selected.id,page,controller.signal).then(result=>{
   if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(result.blob);setUrl(objectUrl);setCount(result.page_count);
  }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'附件预览失败');if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[token,caseId,selected,page]);
 return <>{attachments.length?<ul>{attachments.map(a=><li key={a.id}><Button onClick={()=>{setPage(1);setCount(1);setSelected(a);}}>{a.filename}（{a.kind}）</Button></li>)}</ul>:<Empty description="暂无已确认附件"/>}
 <Modal title={selected?.filename??'附件预览'} open={!!selected} onCancel={()=>setSelected(undefined)} footer={null} width={900} destroyOnHidden>
  <Space><Button disabled={!url||page===1} onClick={()=>setPage(p=>p-1)}>附件上一页</Button><span>第 {page} / {count} 页</span><Button disabled={!url||page>=count} onClick={()=>setPage(p=>p+1)}>附件下一页</Button></Space>
  {error?<Alert type="error" message={error}/>:url?<img src={url} alt="已确认附件安全预览" style={{maxWidth:'100%'}} draggable={false} onContextMenu={e=>e.preventDefault()}/>:<Spin/>}
 </Modal></>;
}
