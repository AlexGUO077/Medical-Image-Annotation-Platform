import { Alert, Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../auth/types';
import { educationApi, EducationError } from './api';
import type { EducationTask } from './types';
export function StudentTasksPage({session,onExpired}:{session:Session;onExpired():void}){
 const [tasks,setTasks]=useState<EducationTask[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(1),[loading,setLoading]=useState(true);const navigate=useNavigate();
 const fail=(e:unknown)=>{setError(e instanceof Error?e.message:'加载失败');if(e instanceof EducationError&&e.status===401)onExpired();};
 useEffect(()=>{let active=true;setLoading(true);setError('');educationApi.tasks(session.token,page).then(v=>{if(active)setTasks(v);}).catch(e=>{if(active)fail(e);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[session.token,page]);
 const open=async(item:EducationTask['items'][number])=>{if(busy)return;setBusy(true);setError('');try{const a=item.attempt_id?{id:item.attempt_id}:await educationApi.start(session.token,item.id);navigate(`/student/attempts/${a.id}${item.state==='submitted'?'/feedback':''}`);}catch(e){fail(e);}finally{setBusy(false);}};
 return <section><Typography.Title level={2}>我的考核</Typography.Title><Typography.Paragraph>独立阅片、标注并填写报告。提交后可查看参考内容进行对照。</Typography.Paragraph>{error&&<Alert type="error" message={error}/>}
 {loading?<Card loading/>:tasks.length===0?<Empty description="暂无已分配的考核"/>:tasks.map(t=><Card key={t.id} title={t.title} extra={<Tag>{t.status==='published'?'进行中':'已关闭'}</Tag>} style={{marginBottom:16}}><p>{t.instructions}</p><Space wrap>{t.items.map(i=><Button key={i.id} loading={busy} disabled={t.status!=='published'&&i.state!=='submitted'} onClick={()=>void open(i)}>第 {i.ordinal} 题 · {i.state==='submitted'?'查看对照':i.attempt_id?'继续作答':'开始作答'}</Button>)}</Space></Card>)}
 <Space><Button disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>第 {page} 页</span><Button disabled={tasks.length<50||loading} onClick={()=>setPage(p=>p+1)}>下一页</Button></Space></section>;
}
