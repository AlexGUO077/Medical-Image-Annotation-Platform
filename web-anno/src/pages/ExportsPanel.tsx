import {Alert,Button,Card,Pagination,Popconfirm,Select,Space,Spin,Table,Typography} from 'antd';
import {useEffect,useState} from 'react';
import type {Session} from '../auth/types';
import {draftAccountId} from '../annotations/drafts';
import {ViewerRequestError} from '../viewer/api';
import {adminApi,saveExport,type Candidate,type ExportRow,type Page} from '../admin/api';
export function ExportsPanel({session,onExpired}:{session:Session;onExpired():void}){
 const me=draftAccountId(session.token);const [data,setData]=useState<Page<ExportRow>>(),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[error,setError]=useState<string>(),[notice,setNotice]=useState<string>(),[busy,setBusy]=useState(false),[operationError,setOperationError]=useState<string>();
 const [candidatePage,setCandidatePage]=useState(1),[candidates,setCandidates]=useState<Candidate[]>([]),[candidateTotal,setCandidateTotal]=useState(0),[candidateError,setCandidateError]=useState<string>(),[candidateLoading,setCandidateLoading]=useState(false),[selected,setSelected]=useState<string[]>([]);
 useEffect(()=>{if(session.role!=='admin')return;const controller=new AbortController();setData(undefined);setError(undefined);adminApi.exports(session.token,page,controller.signal).then(r=>{if(!controller.signal.aborted)setData(r);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e instanceof ViewerRequestError&&[401,403].includes(e.status))onExpired();}});return()=>controller.abort();},[session.token,session.role,page,revision,onExpired]);
 useEffect(()=>{if(session.role!=='admin')return;const c=new AbortController();setCandidateLoading(true);setCandidateError(undefined);
  adminApi.candidates(session.token,candidatePage,c.signal).then(r=>{if(!c.signal.aborted){setCandidates(old=>candidatePage===1?r.items:[...old,...r.items]);setCandidateTotal(r.total);}}).catch(e=>{if(!c.signal.aborted){setCandidateError(e.message);if(e instanceof ViewerRequestError&&[401,403].includes(e.status))onExpired();}}).finally(()=>{if(!c.signal.aborted)setCandidateLoading(false);});return()=>c.abort();},[session.role,session.token,candidatePage,revision,onExpired]);
 useEffect(()=>{const focus=()=>{setCandidatePage(1);setRevision(n=>n+1);};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 if(session.role!=='admin')return <Alert type="error" message="需要管理员权限"/>;
 async function mutate(run:()=>Promise<unknown>,success:string){if(busy)return;setBusy(true);setOperationError(undefined);setNotice(undefined);try{await run();setNotice(success);setSelected([]);}catch(e){setOperationError(`${e instanceof Error?e.message:'操作响应未知'}；请刷新队列核对最终状态，勿自动重试`);if(e instanceof ViewerRequestError&&e.status===401)onExpired();}finally{setBusy(false);setCandidatePage(1);setRevision(n=>n+1);}}
 const available=(r:ExportRow)=>r.status==='已批准'&&r.requester_id===me&&r.download_count===0&&r.expire_at&&Date.parse(r.expire_at)>Date.now();
 return <Space direction="vertical" style={{width:'100%'}}>
  <Typography.Title level={2}>导出申请与审批</Typography.Title><Typography.Paragraph>仅导出已确认脱敏的合成金标准标注 JSON。无影像、报告正文或附件；由另一管理员审批后，申请人可在 24 小时内领取一次，领取开始后响应中断不补次数。</Typography.Paragraph>
  {(operationError||error)&&<Alert type="error" message={operationError||error}/>} {notice&&<Alert type="success" message={notice}/>}
  <Card title="申请合成数据包"><Space wrap>
   <Select aria-label="选择导出病例" style={{minWidth:380,maxWidth:700}} mode="multiple" showSearch optionFilterProp="label" value={selected} onChange={setSelected} disabled={busy} loading={candidateLoading} options={candidates.map(c=>({value:c.id,label:`${c.system_code} · ${c.id} · v${c.version}`}))} placeholder="选择当前发布金标准版本（最多 20 例）"/>
   {candidates.length<candidateTotal&&<Button disabled={busy||candidateLoading||!!candidateError} onClick={()=>setCandidatePage(p=>p+1)}>加载更多病例</Button>}
   <Popconfirm title="提交这些合成病例的导出申请？" onConfirm={()=>mutate(()=>adminApi.create(session.token,selected),'申请已提交，等待另一管理员审批')}><Button type="primary" disabled={busy||selected.length===0||selected.length>20}>提交申请</Button></Popconfirm>
   <Button disabled={busy} onClick={()=>{setCandidatePage(1);setRevision(n=>n+1);}}>刷新队列</Button>
  </Space>{candidateError&&<Alert type="error" message={candidateError}/>}</Card>
  {!data&&!error&&<Spin aria-label="加载导出队列"/>}
  {data&&<><Table rowKey="id" pagination={false} dataSource={data.items} scroll={{x:1000}} columns={[
   {title:'申请',dataIndex:'id'},{title:'申请人',dataIndex:'requester_id'},{title:'状态',dataIndex:'status',width:90},
   {title:'病例版本',render:(_:unknown,r:ExportRow)=>r.case_versions.map(v=>`${v.id} · v${v.version}`).join('；')},
   {title:'有效期（北京时间）',render:(_:unknown,r:ExportRow)=>r.expire_at?new Date(r.expire_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):(r.status==='待审批'?'待审批':'—')},
   {title:'操作',render:(_:unknown,r:ExportRow)=><Space>{r.status==='待审批'&&r.requester_id!==me&&me&&<><Popconfirm title="批准此申请并生成一次领取链接？" onConfirm={()=>mutate(()=>adminApi.decide(session.token,r.id,'approve'),'审批已完成')}><Button disabled={busy}>批准</Button></Popconfirm><Popconfirm title="拒绝此申请？" onConfirm={()=>mutate(()=>adminApi.decide(session.token,r.id,'reject'),'申请已拒绝')}><Button disabled={busy}>拒绝</Button></Popconfirm></>}{r.requester_id===me&&r.status==='待审批'&&<Typography.Text>本人不能自批</Typography.Text>}{available(r)&&<Popconfirm title="现在领取？此机会仅一次，开始后中断不补发。" onConfirm={()=>mutate(async()=>{const blob=await adminApi.download(session.token,r.id);saveExport(blob,r.id);},'领取已开始，请核对浏览器下载结果')}><Button disabled={busy}>领取 JSON</Button></Popconfirm>}{r.download_count===1&&<Typography.Text>已领取</Typography.Text>}</Space>},
  ]}/><Pagination current={page} pageSize={20} total={data.total} showSizeChanger={false} onChange={setPage}/></>}
 </Space>;
}
