import {Alert,Button,Form,Input,Pagination,Space,Spin,Table,Typography} from 'antd';
import {useEffect,useState} from 'react';
import type {Session} from '../auth/types';
import {adminApi,type AuditRow,type Page} from '../admin/api';
import {ViewerRequestError} from '../viewer/api';
export function AuditPanel({session,onExpired}:{session:Session;onExpired():void}){
 const [draft,setDraft]=useState<Record<string,string>>({}),[query,setQuery]=useState<Record<string,string>>({}),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[data,setData]=useState<Page<AuditRow>>(),[error,setError]=useState<string>();
 useEffect(()=>{if(session.role!=='admin')return;const c=new AbortController();setData(undefined);setError(undefined);adminApi.audit(session.token,page,query,c.signal).then(r=>{if(!c.signal.aborted)setData(r);}).catch(e=>{if(!c.signal.aborted){setError(e.message);if(e instanceof ViewerRequestError&&[401,403].includes(e.status))onExpired();}});return()=>c.abort();},[session.token,session.role,page,revision,query,onExpired]);
 useEffect(()=>{const focus=()=>setRevision(n=>n+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 if(session.role!=='admin')return <Alert type="error" message="需要管理员权限"/>;
 return <Space direction="vertical" style={{width:'100%'}}><Typography.Title level={2}>审计日志查询</Typography.Title><Typography.Paragraph>记录只读，不能编辑或删除。时间按北京时间筛选，包含起点、不含终点；详情仅展示必要追踪字段。</Typography.Paragraph>
  <Form layout="inline" style={{gap:12}} onFinish={()=>{const next={...draft};for(const k of ['from','to'])if(next[k])next[k]=`${next[k]}:00+08:00`;setPage(1);setQuery(next);setRevision(n=>n+1);}}>
   {[['actor','操作者 UUID'],['action','动作'],['target','目标'],['from','起始时间'],['to','结束时间']].map(([key,label])=><Form.Item key={key} label={label}><Input aria-label={'审计'+label} type={key==='from'||key==='to'?'datetime-local':'text'} value={draft[key]??''} onChange={e=>setDraft(old=>({...old,[key!]:e.target.value}))}/></Form.Item>)}
   <Button htmlType="submit" type="primary">查询日志</Button><Button onClick={()=>setRevision(n=>n+1)}>刷新日志</Button>
  </Form>{error&&<Alert type="error" message={error}/>} {!data&&!error&&<Spin aria-label="加载审计"/>}
  {data&&<><Table rowKey="id" dataSource={data.items} pagination={false} scroll={{x:1000}} columns={[
   {title:'时间（北京时间）',dataIndex:'created_at',render:(v:string)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})},
   {title:'操作者',dataIndex:'actor',render:(v:string|null)=>v??'系统后台'}, {title:'动作',dataIndex:'action'},{title:'目标',dataIndex:'target'},{title:'来源 IP',dataIndex:'ip'},
   {title:'追踪详情',dataIndex:'detail',render:(v:Record<string,unknown>)=><Typography.Text style={{overflowWrap:'anywhere'}}>{JSON.stringify(v)}</Typography.Text>},
  ]}/><Pagination current={page} pageSize={20} total={data.total} showSizeChanger={false} onChange={setPage}/></>}
 </Space>;
}
