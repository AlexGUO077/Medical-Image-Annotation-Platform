import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { tasksApi, DISPATCH_MODES, type AutoDispatch, type Assignee, type Page, type Task, type TaskCase } from '../tasks/api';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败';
const limitRules = [{ validator: (_: unknown, value: unknown) => value == null || (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647) ? Promise.resolve() : Promise.reject(new Error('上限须为正整数或留空')) }];
export function unavailableReason(user: Assignee, task: Task,role:'annotate'|'review'='annotate'): string | undefined {
  if (user.status !== 'active' || user.expire_at < new Date().toISOString().slice(0, 10)) return '账号不可用';
  if (user.must_change_password || (user.role === 'admin' && !user.mfa_enabled)) return '未完成安全设置';
  const quals = user.quals[task.system_code] ?? [];
  if (!quals.includes(role) || (task.review_mode === 'self' && !quals.includes(role==='annotate'?'review':'annotate'))) return '缺少任务所需资格';
  return undefined;
}

export function TaskDispatchPanel({ token, task, onBusyChange, onChanged }: {
  token: string; task: Task; onBusyChange: (busy: boolean) => void; onChanged: () => void;
}) {
  const [casePage, setCasePage] = useState(1), [userPage, setUserPage] = useState(1);
  const [cases, setCases] = useState<Page<TaskCase>>(), [users, setUsers] = useState<Page<Assignee>>();
  const [caseError, setCaseError] = useState<string>(), [userError, setUserError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [selectedCases, setSelectedCases] = useState<string[]>([]), [assignee, setAssignee] = useState<Assignee>();
  const [role,setRole]=useState<'annotate'|'review'>('annotate');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const [error, setError] = useState<string>(), [notice, setNotice] = useState<string>();
  const [editingUser, setEditingUser] = useState<Assignee>();
  const [reclaiming, setReclaiming] = useState<TaskCase>();
  const [mode, setMode] = useState(task.dispatch_mode);
  const [autoCursor, setAutoCursor] = useState<string>();
  const refresh = () => { setSelectedCases([]); setAssignee(undefined); setRevision(value => value + 1); };
  useEffect(() => {
    const controller = new AbortController(); setCases(undefined); setCaseError(undefined);
    tasksApi.cases(token, task.id, casePage, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCases(value); })
      .catch(reason => { if (!controller.signal.aborted) setCaseError(errorMessage(reason)); });
    return () => controller.abort();
  }, [token, task.id, casePage, revision]);
  useEffect(() => {
    const controller = new AbortController(); setUsers(undefined); setUserError(undefined);
    tasksApi.assignees(token, userPage, controller.signal)
      .then(value => { if (!controller.signal.aborted) setUsers(value); })
      .catch(reason => { if (!controller.signal.aborted) setUserError(errorMessage(reason)); });
    return () => controller.abort();
  }, [token, userPage, revision]);
  async function save(action: () => Promise<unknown>, success: string, done?: () => void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError(undefined); setNotice(undefined);
    try {
      const result = await action() as { auto_dispatch?: AutoDispatch; dispatch_mode?: Task['dispatch_mode'] };
      if (result.dispatch_mode) setMode(result.dispatch_mode);
      if (result.auto_dispatch) setAutoCursor(result.auto_dispatch.next_case_id ?? undefined);
      setNotice(result.auto_dispatch?.status === 'pending' ? `${success}；自动派单尚未完成，请重试自动派单` :
        result.auto_dispatch ? `${success}；自动指派 ${result.auto_dispatch.assigned?.length ?? 0} 例，其余保留待分配` : success);
      done?.(); onChanged();
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  function dispatch() {
    if (!assignee || !selectedCases.length || !cases || !users || unavailableReason(assignee, task,role)) return;
    let dueAt: string | null = null;
    if (due) {
      const timestamp = new Date(due).getTime();
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) { setError('截止时间必须晚于当前时间'); return; }
      dueAt = new Date(timestamp).toISOString();
    }
    void save(() => tasksApi.dispatch(token, { mode: 'manual', task_id: task.id, assignee_id: assignee.id, case_ids: selectedCases, due_at: dueAt,...(role==='review'?{task_role:role}:{}) }), role==='review'?'审核指派成功，等待审核人开始':'指派成功，病例已进入标注中', refresh);
  }
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {notice && <Alert type="success" message={notice} showIcon />}
    {error && <Alert type="error" message={error} showIcon />}
    <Typography.Title level={4}>任务设置</Typography.Title>
    <Form layout="vertical" disabled={busy} initialValues={{ priority: task.priority, in_flight_limit: task.in_flight_limit, dispatch_mode: task.dispatch_mode }} onFinish={values => void save(() => tasksApi.settings(token, task.id, { priority: values.priority as number, in_flight_limit: (values.in_flight_limit as number | null) ?? null, dispatch_mode: values.dispatch_mode as Task['dispatch_mode'] }), '任务设置已保存', refresh)}>
      <Form.Item name="dispatch_mode" label="分发模式" rules={[{ required: true }]}><Select options={DISPATCH_MODES} /></Form.Item>
      <Form.Item name="priority" label="任务优先级" rules={[{ required: true, type: 'integer', min: -2147483648, max: 2147483647, message: '请填写 int32 范围的整数' }]}><InputNumber /></Form.Item>
      <Form.Item name="in_flight_limit" label="每人每任务在途上限" rules={limitRules}><InputNumber placeholder="留空不限制" /></Form.Item>
      <Typography.Paragraph type="secondary">限额留空不限制；降低限额不会回收已有分派。</Typography.Paragraph>
      <Button htmlType="submit" loading={busy}>保存任务设置</Button>
    </Form>
    {mode === 'auto' && <Button disabled={busy} onClick={() => void save(async () => ({ auto_dispatch: { status: 'completed', ...await tasksApi.auto(token, task.id, autoCursor) } }), '自动派单已执行', refresh)}>{autoCursor ? '继续下一批自动派单' : '重试自动派单'}</Button>}
    {mode === 'auto' && autoCursor && <Button disabled={busy} onClick={() => void save(async () => ({ auto_dispatch: { status: 'completed', ...await tasksApi.auto(token, task.id) } }), '自动派单已执行', refresh)}>从头重新派单</Button>}
    <Typography.Title level={4}>手动指派{role==='annotate'?'标注':'审核'}</Typography.Title>
    <Select aria-label="指派角色" disabled={busy} value={role} options={[{value:'annotate',label:'标注'},{value:'review',label:'审核'}]} onChange={value=>{setRole(value);setSelectedCases([]);setAssignee(undefined);}}/>
    <Button disabled={busy} onClick={refresh}>刷新分派数据</Button>
    {caseError && <Alert type="error" message={`病例加载失败：${caseError}`} />}
    <Table<TaskCase> size="small" rowKey="id" loading={!cases && !caseError} dataSource={cases?.items ?? []}
      columns={[{ title: '病例编号', dataIndex: 'case_no' }, { title: '状态', dataIndex: 'status' }, { title: '回收', render: (_, row) => row.assignment_id && ['标注中','待审核','审核中'].includes(row.status) ? <Button disabled={busy} onClick={() => { setError(undefined); setReclaiming(row); }}>回收</Button> : null }]}
      rowSelection={{ selectedRowKeys: selectedCases, onChange: keys => setSelectedCases(keys.map(String)), getCheckboxProps: row => ({ disabled: busy || row.status !== (role==='review'?'待审核':'待分配') || (role==='review'&&!!row.assignment_id) }) }}
      pagination={{ current: casePage, pageSize: 20, total: cases?.total ?? 0, disabled: busy, showSizeChanger: false, onChange: page => { setSelectedCases([]); setCases(undefined); setCasePage(page); } }} />
    <Typography.Text>已选 {selectedCases.length} 例；仅可选择{role==='review'?'待审核且未分派':'待分配'}病例。</Typography.Text>
    {userError && <Alert type="error" message={`人员加载失败：${userError}`} />}
    <Table<Assignee> size="small" rowKey="id" loading={!users && !userError} dataSource={users?.items ?? []}
      columns={[
        { title: '人员', render: (_, user) => `${user.real_name}（${user.username}）` },
        { title: '系统资格', render: (_, user) => (user.quals[task.system_code] ?? []).map(q => q === 'annotate' ? '标注' : '审核').join('、') || '无' },
        { title: '指派条件', render: (_, user) => unavailableReason(user, task,role) ?? '资格符合，提交时校验容量' },
        { title: '全局上限', render: (_, user) => user.in_flight_limit ?? '不限制' },
        { title: '设置', render: (_, user) => <Button disabled={busy} onClick={() => { setError(undefined); setEditingUser(user); }} aria-label={`设置 ${user.username} 全局上限`}>设置上限</Button> },
      ]}
      rowSelection={{ type: 'radio', selectedRowKeys: assignee ? [assignee.id] : [], onChange: (_, rows) => setAssignee(rows[0]), getCheckboxProps: user => ({ disabled: busy || !!unavailableReason(user, task,role) }) }}
      pagination={{ current: userPage, pageSize: 20, total: users?.total ?? 0, disabled: busy, showSizeChanger: false, onChange: page => { setAssignee(undefined); setUsers(undefined); setUserPage(page); } }} />
    <label>分派截止时间（本地时间，可留空）<Input aria-label="分派截止时间" type="datetime-local" value={due} disabled={busy} onChange={event => setDue(event.target.value)} /></label>
    <Typography.Text type="secondary">截止时间留空不自动超时。人员资格与两级容量以服务端提交校验为准。</Typography.Text>
    <Button type="primary" disabled={busy || !selectedCases.length || !assignee || !cases || !users || !!caseError || !!userError} loading={busy} onClick={dispatch}>确认指派</Button>
    <Modal title={`回收分派：${reclaiming?.case_no ?? ''}`} open={!!reclaiming} footer={null} onCancel={() => { if (!busy) setReclaiming(undefined); }} closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
      {reclaiming && <Form layout="vertical" disabled={busy} onFinish={values => void save(() => tasksApi.reclaim(token, reclaiming.assignment_id!, values.reason as 'overdue' | 'quality'), '分派已回收', () => { setReclaiming(undefined); refresh(); })}>
        <Typography.Paragraph>原分派将失效，已有标注保留。自动模式会再次派单；定向改派请先切换为手动模式。</Typography.Paragraph>
        <Form.Item name="reason" label="回收原因" rules={[{ required: true, message: '请选择回收原因' }]}><Select options={[{ value: 'overdue', label: '逾期' }, { value: 'quality', label: '质量问题' }]} /></Form.Item>
        {error && <Alert type="error" message={error} />}
        <Button htmlType="submit" loading={busy}>确认回收</Button>
      </Form>}
    </Modal>
    <Modal title={editingUser ? `人员全局上限：${editingUser.real_name}` : '人员全局上限'} open={!!editingUser} footer={null} onCancel={() => { if (!busy) setEditingUser(undefined); }} closable={!busy} maskClosable={!busy} keyboard={!busy} destroyOnHidden>
      {editingUser && error && <Alert type="error" message={error} showIcon />}
      {editingUser && <Form key={editingUser.id} layout="vertical" disabled={busy} initialValues={{ limit: editingUser.in_flight_limit }} onFinish={values => void save(() => tasksApi.personLimit(token, editingUser.id, (values.limit as number | null) ?? null), '人员全局上限已保存', () => { setEditingUser(undefined); refresh(); })}>
        <Form.Item name="limit" label="人员跨任务在途上限" rules={limitRules}><InputNumber placeholder="留空不限制" /></Form.Item>
        <Button htmlType="submit" loading={busy}>保存人员上限</Button>
      </Form>}
    </Modal>
  </Space>;
}
