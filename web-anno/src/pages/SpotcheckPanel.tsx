import { Alert, Button, Modal, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { tasksApi, type SpotcheckBatch, type Task } from '../tasks/api';

export function SpotcheckPanel({token,task}:{token:string;task:Task}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState<SpotcheckBatch>(),[error,setError]=useState<string>();
  const pending=useRef(false),controller=useRef<AbortController>();
  useEffect(()=>()=>controller.current?.abort(),[]);
  const sample=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError(undefined);setResult(undefined);
    const next=new AbortController();controller.current=next;
    try{const value=await tasksApi.spotchecks(token,task.id,next.signal);if(!next.signal.aborted)setResult(value);}
    catch(e){if(!next.signal.aborted)setError(e instanceof Error?e.message:'抽检生成失败，请刷新任务核对');}
    finally{if(!next.signal.aborted){pending.current=false;setBusy(false);}}
  };
  return <><Button disabled={task.status!=='进行中'||task.source!=='synthetic'} onClick={()=>{setOpen(true);setError(undefined);}}>发起抽检</Button>
    <Modal title={`${task.name}：10% 抽检`} open={open} onCancel={()=>{if(!busy)setOpen(false);}} closable={!busy} maskClosable={!busy} keyboard={!busy}
      footer={<Space><Button disabled={busy} onClick={()=>setOpen(false)}>关闭</Button><Button type="primary" loading={busy} disabled={busy} onClick={()=>void sample()}>确认生成抽检</Button></Space>}>
      <p>系统从本任务尚未参与抽样的已发布版本随机抽取 10%，向上取整；1～9 例也抽 1 例。同版只参与一轮，重新发布的新版本可再次参与。</p>
      <p>审核人按互审资格和在途上限自动分派；无人可派的目标保留待派，由后台补派。抽检失败立即下线该病例，并全面复核本轮同标注人的其他候选病例。</p>
      {error&&<Alert type="error" message={error}/>}
      {result&&<Alert type={result.pending_count?'warning':'success'} message={result.candidate_count?`本轮候选 ${result.candidate_count} 例，抽中 ${result.sampled_count} 例`:'没有尚未参与抽样的已发布版本'} description={`已分派 ${result.assigned_count} 例，待派 ${result.pending_count} 例。${result.pending_count?'请检查审核资格和容量；待派目标不会丢失。':''}`}/>}
    </Modal></>;
}
