import {Alert,Button,Popconfirm,Space,Table,Typography,Pagination} from 'antd';
import {useEffect,useState} from 'react';
import type {Session} from '../auth/types';
import type {Assignee,Page} from '../tasks/api';
import {adminApi} from '../admin/api';
import {ViewerRequestError} from '../viewer/api';
export function AccountUnlockPanel({session,onExpired}:{session:Session;onExpired():void}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<Page<Assignee>>(),[error,setError]=useState<string>(),[busy,setBusy]=useState(false),[operationError,setOperationError]=useState<string>();
 useEffect(()=>{if(session.role!=='admin')return;const c=new AbortController();setData(undefined);setError(undefined);adminApi.users(session.token,page,c.signal).then(r=>{if(!c.signal.aborted)setData(r);}).catch(e=>{if(!c.signal.aborted)setError(e.message);if(e instanceof ViewerRequestError&&[401,403].includes(e.status))onExpired();});return()=>c.abort();},[session.token,session.role,page,revision,onExpired]);
 useEffect(()=>{const focus=()=>setRevision(n=>n+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 if(session.role!=='admin')return null;
 async function enable(id:string){if(busy)return;setBusy(true);setOperationError(undefined);try{await adminApi.enable(session.token,id);}catch(e){setOperationError(e instanceof Error?e.message:'响应未知，请刷新核对');}finally{setBusy(false);setRevision(n=>n+1);}}
 return <Space direction="vertical" style={{width:'100%'}}><Typography.Title level={2}>异常账号解锁</Typography.Title><Typography.Paragraph>先核实审计与异常原因，再重新启用停用账号。旧会话和帧票据继续失效，账号须重新登录；过期或安全设置未完成时仍拒绝访问。</Typography.Paragraph>{(error||operationError)&&<Alert type="error" message={error||operationError}/>}<Button onClick={()=>setRevision(n=>n+1)}>刷新账号</Button>
 {data&&<><Table rowKey="id" dataSource={data.items} pagination={false} columns={[{title:'账号',dataIndex:'username'},{title:'姓名',dataIndex:'real_name'},{title:'状态',dataIndex:'status'},{title:'操作',render:(_:unknown,u:Assignee)=>u.status==='disabled'?<Popconfirm title="已核实异常，重新启用此账号？" onConfirm={()=>enable(u.id)}><Button disabled={busy}>重新启用</Button></Popconfirm>:null}]}/><Pagination pageSize={20} current={page} total={data.total} showSizeChanger={false} onChange={setPage}/></>}
 </Space>;
}
