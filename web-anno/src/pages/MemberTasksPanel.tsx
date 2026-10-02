import { Alert, Button, Select, Space, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { tasksApi, type Page, type QueueCase } from '../tasks/api';
const message = (error: unknown) => error instanceof Error ? error.message : '任务请求失败';
export function MemberTasksPanel({ token }: { token: string }) {
  const [role,setRole]=useState<'annotate'|'review'>('annotate');
  const [mine, setMine] = useState<Page<QueueCase>>(), [pool, setPool] = useState<Page<QueueCase>>();
  const [minePage, setMinePage] = useState(1), [poolPage, setPoolPage] = useState(1), [revision, setRevision] = useState(0);
  const [mineError, setMineError] = useState<string>(), [poolError, setPoolError] = useState<string>();
  const [error, setError] = useState<string>(), [notice, setNotice] = useState<string>(), [busy, setBusy] = useState(false);
  const pending = useRef(false);
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
    try{await tasksApi.startReview(token,row.task_id,row.case_id);setNotice('已进入审核中');setRevision(n=>n+1);}catch(e){setError(message(e));}finally{pending.current=false;setBusy(false);}
  }
  const columns = [{ title: '任务', dataIndex: 'task_name' }, { title: '病例编号', dataIndex: 'case_no' }, { title: '优先级', dataIndex: 'priority' }, { title: '状态', dataIndex: 'status' }];
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Title level={2}>个人任务与{role==='review'?'审核':'标注'}领取池</Typography.Title>
    <Select aria-label="任务角色" disabled={busy} value={role} options={[{value:'annotate',label:'标注'},{value:'review',label:'审核'}]} onChange={value=>{setRole(value);setMine(undefined);setPool(undefined);setMinePage(1);setPoolPage(1);setNotice(undefined);setError(undefined);}}/>
    <Button disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新任务</Button>
    {notice && <Alert type="success" message={notice} />}{error && <Alert type="error" message={error} />}
    <Typography.Title level={3}>我的在途{role==='review'?'审核':'标注'}</Typography.Title>
    {mineError && <Alert type="error" message={`个人任务加载失败：${mineError}`} />}
    <Table<QueueCase> rowKey="case_id" columns={[...columns, { title: '阅片', render: (_, row) => role==='annotate'?<Link to={`/workbench/${encodeURIComponent(row.case_id)}`}>进入工作台</Link>:row.status==='待审核'?<Button disabled={busy} onClick={()=>void start(row)}>开始审核</Button>:<span>审核任务已开始</span> }, { title: '截止时间', render: (_, row) => row.due_at ? new Date(row.due_at).toLocaleString() : '未设置' }]} dataSource={mine?.items ?? []} loading={!mine && !mineError}
      pagination={{ current: minePage, pageSize: 20, total: mine?.total ?? 0, showSizeChanger: false, disabled: busy, onChange: setMinePage }} />
    <Typography.Title level={3}>可领取{role==='review'?'审核':'标注'}</Typography.Title>
    <Typography.Text type="secondary">按系统资格展示；领取时校验当前状态和两级在途上限。{role==='annotate'?'可从本人在途任务进入工作台。':'审核结论界面将在后续阶段开放。'}</Typography.Text>
    {poolError && <Alert type="error" message={`领取池加载失败：${poolError}`} />}
    <Table<QueueCase> rowKey="case_id" columns={[...columns, { title: '操作', render: (_, row) => <Button disabled={busy} onClick={() => void claim(row)}>领取</Button> }]} dataSource={pool?.items ?? []} loading={!pool && !poolError}
      pagination={{ current: poolPage, pageSize: 20, total: pool?.total ?? 0, showSizeChanger: false, disabled: busy, onChange: setPoolPage }} />
  </Space>;
}
