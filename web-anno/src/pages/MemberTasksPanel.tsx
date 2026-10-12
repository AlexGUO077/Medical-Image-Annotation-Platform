import { Alert, Button, Empty, Pagination, Select, Spin, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { tasksApi, type Page, type QueueCase } from '../tasks/api';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { SYSTEM_OPTIONS, IMPORT_SOURCE_OPTIONS } from '../cases/types';
const message = (error: unknown) => error instanceof Error ? error.message : '任务请求失败';
export function MemberTasksPanel({ token }: { token: string }) {
  const [role,setRole]=useState<'annotate'|'review'>('annotate');
  const [mine, setMine] = useState<Page<QueueCase>>(), [pool, setPool] = useState<Page<QueueCase>>();
  const [minePage, setMinePage] = useState(1), [poolPage, setPoolPage] = useState(1), [revision, setRevision] = useState(0);
  const [mineError, setMineError] = useState<string>(), [poolError, setPoolError] = useState<string>();
  const [error, setError] = useState<string>(), [notice, setNotice] = useState<string>(), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [selectedId,setSelectedId]=useState<string>();
  const [detailsOpen,setDetailsOpen]=useState(true);
  useEffect(()=>setSelectedId(undefined),[token,role,minePage,poolPage,revision]);
  useEffect(() => {
    const controller = new AbortController(); setMine(undefined); setMineError(undefined);
    tasksApi.mine(token, minePage, controller.signal,role).then(value => { if (!controller.signal.aborted) setMine(value); })
      .catch(reason => { if (!controller.signal.aborted) setMineError(message(reason)); });
    return () => controller.abort();
  }, [token, minePage, revision,role]);
  useEffect(() => {
    const controller = new AbortController(); setPool(undefined); setPoolError(undefined);
    tasksApi.pool(token, poolPage, controller.signal,role).then(value => { if (!controller.signal.aborted) setPool(value); })
      .catch(reason => { if (!controller.signal.aborted) setPoolError(message(reason)); });
    return () => controller.abort();
  }, [token, poolPage, revision,role]);
  async function claim(row: QueueCase) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined); setNotice(undefined);
    try { await tasksApi.claim(token, row.task_id, row.case_id,role); setNotice(role==='review'?'领取成功，病例已进入审核中':'领取成功，病例已进入标注中'); setRevision(value => value + 1); }
    catch (reason) { setError(message(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function start(row:QueueCase){
    if(pending.current)return;pending.current=true;setBusy(true);setError(undefined);
    try{await tasksApi.startReview(token,row.task_id,row.case_id,...(['spotcheck','recheck'].includes(row.review_kind??'')?[row.assignment_id]:[]));setNotice(['spotcheck','recheck'].includes(row.review_kind??'')?'质量审核已开始，病例保持发布':'已进入审核中');setRevision(n=>n+1);}catch(e){setError(message(e));}finally{pending.current=false;setBusy(false);}
  }
  const selected=[...(mine?.items??[]),...(pool?.items??[])].find(row=>`${row.task_id}:${row.case_id}`===selectedId);
  const roleLabel=role==='review'?'审核':'标注';
  const reviewLabel=(row:QueueCase)=>row.review_kind==='spotcheck'?'抽检':row.review_kind==='recheck'?'全面复核':'普通任务';
  const dateLabel=(row:QueueCase)=>row.due_at?new Date(row.due_at).toLocaleString():'未设置';
  const action=(row:QueueCase,inPool:boolean)=>inPool?<Button disabled={busy} onClick={()=>void claim(row)}>领取</Button>:role==='annotate'?<Link className="task-entry-link" to={`/workbench/${encodeURIComponent(row.case_id)}`}>进入工作台 <ViewerIcon name="right"/></Link>:(row.status==='待审核'||(['spotcheck','recheck'].includes(row.review_kind??'')&&!row.started_at))?<Button disabled={busy} onClick={()=>void start(row)}>开始审核</Button>:<Link className="task-entry-link" to={`/review/${encodeURIComponent(row.case_id)}`}>进入审核台 <ViewerIcon name="right"/></Link>;
  const queue=(value:Page<QueueCase>|undefined,inPool:boolean,loadError?:string)=>{
    const groups=new Map<string,QueueCase[]>();for(const row of value?.items??[])groups.set(row.task_id,[...(groups.get(row.task_id)??[]),row]);
    return <section className="task-queue" aria-label={inPool?`可领取${roleLabel}`:`我的在途${roleLabel}`}><div className="task-queue-heading"><h3>{inPool?`可领取${roleLabel}`:`我的在途${roleLabel}`}</h3><span>{value?.total??'—'} 个病例</span></div>
      {loadError?<Alert type="error" message={`${inPool?'领取池':'个人任务'}加载失败：${loadError}`}/>:!value?<div className="task-loading"><Spin aria-label="加载任务"/></div>:!value.items.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={inPool?'暂无可领取的病例':'暂无在途任务'}/>:<div className="task-groups">{[...groups].map(([id,rows])=><article className="task-group" key={id}><header><span><ViewerIcon name="library"/> {rows[0].task_name}</span><span>{rows.length} 例 · 当前页</span></header>{rows.map(row=><div className={`task-case-row${selectedId===`${row.task_id}:${row.case_id}`?' is-selected':''}`} key={row.case_id}>
        <button type="button" className="task-case-select" onClick={()=>{setSelectedId(`${row.task_id}:${row.case_id}`);setDetailsOpen(true);}}><b>{row.case_no}</b><span>{SYSTEM_OPTIONS.find(s=>s.value===row.system_code)?.label??row.system_code} · {roleLabel} · {reviewLabel(row)}</span><span>截止：{dateLabel(row)}</span></button>
        <Tag color={row.status==='审核中'?'purple':row.status==='标注中'?'blue':'default'}>{row.status}</Tag><span className="task-priority">优先级 {row.priority}</span><div className="task-row-action">{action(row,inPool)}</div>
      </div>)}</article>)}</div>}
      {!!value?.total&&<Pagination current={inPool?poolPage:minePage} pageSize={20} total={value.total} showSizeChanger={false} disabled={busy} onChange={inPool?setPoolPage:setMinePage}/>}
    </section>;
  };
  return <section className="member-tasks-page">
    <header className="tasks-page-heading"><div><span className="page-eyebrow">工作队列</span><Typography.Title level={2}>个人任务与{roleLabel}领取池</Typography.Title><p>选择病例查看任务详情，继续在途工作或领取新病例。</p></div><div className="tasks-toolbar">
      <Select aria-label="任务角色" disabled={busy} value={role} style={{width:118}} options={[{value:'annotate',label:'标注'},{value:'review',label:'审核'}]} onChange={value=>{setRole(value);setMine(undefined);setPool(undefined);setMinePage(1);setPoolPage(1);setNotice(undefined);setError(undefined);}}/>
      <Button icon={<ViewerIcon name="reset"/>} disabled={busy} onClick={()=>setRevision(value=>value+1)}>刷新任务</Button>
      <Button icon={<ViewerIcon name="layout"/>} aria-label={detailsOpen?'收起任务详情':'展开任务详情'} onClick={()=>setDetailsOpen(!detailsOpen)}/>
    </div></header>
    {notice&&<Alert type="success" showIcon message={notice}/>} {error&&<Alert type="error" showIcon message={error}/>}
    <div className={`tasks-split${detailsOpen?'':' details-collapsed'}`}><div className="tasks-list-area">{queue(mine,false,mineError)}{queue(pool,true,poolError)}<p className="task-queue-note">按系统资格展示；领取时校验当前状态和两级在途上限。{role==='annotate'?'可从本人在途任务进入工作台。':'抽检和全面复核由系统派单；从我的在途审核显式开始。'}</p></div>
    {detailsOpen&&<aside className="task-detail-panel" aria-label="任务详情"><div className="task-detail-heading"><ViewerIcon name="info"/><h3>任务详情</h3><Button type="text" aria-label="收起任务详情面板" icon={<ViewerIcon name="right"/>} onClick={()=>setDetailsOpen(false)}/></div>{selected?<><div className="task-detail-identity"><span>当前病例</span><strong>{selected.case_no}</strong><Tag color="blue">{selected.status}</Tag></div><dl><dt>任务</dt><dd>{selected.task_name}</dd><dt>工作角色</dt><dd>{roleLabel} · {reviewLabel(selected)}</dd><dt>系统</dt><dd>{SYSTEM_OPTIONS.find(s=>s.value===selected.system_code)?.label??selected.system_code}</dd><dt>数据来源</dt><dd>{IMPORT_SOURCE_OPTIONS.find(s=>s.value===selected.source)?.label??selected.source}</dd><dt>优先级</dt><dd>{selected.priority}</dd><dt>截止时间</dt><dd>{dateLabel(selected)}</dd><dt>审核模式</dt><dd>{selected.review_mode==='self'?'自审':'他审'}</dd></dl></>:<div className="task-detail-empty"><ViewerIcon name="select"/><h4>选择一个病例</h4><p>点击左侧病例编号，查看任务、截止时间及审核方式。</p></div>}</aside>}
    </div>
  </section>;
}
