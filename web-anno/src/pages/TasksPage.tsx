import { Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { MemberTasksPanel } from './MemberTasksPanel';
import { TaskDispatchPanel } from './TaskDispatchPanel';
import type { Session } from '../auth/types';
import { IMPORT_SOURCE_OPTIONS, SYSTEM_OPTIONS, type ImportSource, type SystemCode } from '../cases/types';
import { tasksApi, DISPATCH_MODES, type AutoDispatch, type CreateTask, type Page, type Task, type TaskCase } from '../tasks/api';

const message = (error: unknown) => error instanceof Error ? error.message : '任务请求失败';
const label = (options: readonly { value: string; label: string }[], value: string) => options.find(option => option.value === value)?.label ?? value;
const columns = [{ title: '病例编号', dataIndex: 'case_no' }, { title: '病例状态', dataIndex: 'status' }];

export function TasksPage({ session }: { session: Session }) {
  if (session.role !== 'admin') return <MemberTasksPanel token={session.token} />;
  return <AdminTasks token={session.token} />;
}

function AdminTasks({ token }: { token: string }) {
  const [data, setData] = useState<Page<Task>>();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<ImportSource>();
  const [system, setSystem] = useState<SystemCode>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [createBusy, setCreateBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task>();
  const [managing, setManaging] = useState<Task>();
  const [manageBusy, setManageBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined); setData(undefined);
    tasksApi.list(token, { page, pageSize: 20, source, system_code: system }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, page, source, system, revision]);
  return <section>
    <Typography.Title level={2}>任务列表</Typography.Title>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="筛选数据来源" placeholder="全部来源" allowClear options={[...IMPORT_SOURCE_OPTIONS]} value={source} style={{ width: 190 }} onChange={value => { setSource(value); setPage(1); }} />
      <Select aria-label="筛选系统" placeholder="全部系统" allowClear options={[...SYSTEM_OPTIONS]} value={system} style={{ width: 170 }} onChange={value => { setSystem(value); setPage(1); }} />
      <Button onClick={() => setRevision(value => value + 1)}>刷新任务</Button>
      <Button type="primary" onClick={() => { setNotice(undefined); setCreating(true); }}>新建任务</Button>
    </Space>
    {notice && <Alert type="success" message={notice} showIcon style={{ marginBottom: 12 }} />}
    {error && <Alert type="error" message={`任务列表加载失败：${error}`} showIcon />}
    {loading ? <Spin aria-label="加载任务" /> : !error && <>
      {!data?.items.length && <Empty description="暂无符合条件的任务" />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {data?.items.map(task => <Card key={task.id} size="small" title={task.name} extra={<Space><Button onClick={() => setSelected(task)}>查看病例</Button><Button disabled={task.status !== '进行中'} onClick={() => setManaging(task)}>分派与设置</Button></Space>}>
          <Space wrap><Tag>{task.status}</Tag><span>{label(IMPORT_SOURCE_OPTIONS, task.source)}</span><span>{label(SYSTEM_OPTIONS, task.system_code)}</span>
            <span>{label(DISPATCH_MODES, task.dispatch_mode)}</span><span>优先级：{task.priority}</span><span>每人在途上限：{task.in_flight_limit ?? '不限制'}</span><span>{task.review_mode === 'self' ? '自审' : '他审'}</span><span>病例数：{task.case_count}</span></Space>
        </Card>)}
      </Space>
      {!!data?.total && <Pagination style={{ marginTop: 16 }} current={page} pageSize={20} total={data.total} showSizeChanger={false} onChange={setPage} />}
    </>}
    <Modal title="新建任务" open={creating} footer={null} onCancel={() => { if (!createBusy) setCreating(false); }} closable={!createBusy} maskClosable={!createBusy} keyboard={!createBusy} width={800} destroyOnHidden>
      {creating && <CreateTaskForm token={token} onBusyChange={setCreateBusy} onCreated={result => {
        setCreating(false); setNotice(result?.auto_dispatch ? (result.auto_dispatch.status === 'pending' ? '任务已创建，自动派单尚未完成，可在分派与设置中重试' : `任务已创建，自动指派 ${result.auto_dispatch.assigned?.length ?? 0} 例，其余保留待分配`) : '任务已创建，病例进入待分配'); setPage(1); setSource(undefined); setSystem(undefined); setRevision(value => value + 1);
      }} />}
    </Modal>
    <Drawer title={managing ? `${managing.name}：分派与设置` : '分派与设置'} open={!!managing} onClose={() => { if (!manageBusy) setManaging(undefined); }} closable={!manageBusy} maskClosable={!manageBusy} keyboard={!manageBusy} width={900} destroyOnHidden>
      {managing && <TaskDispatchPanel key={managing.id} token={token} task={managing} onBusyChange={setManageBusy} onChanged={() => setRevision(value => value + 1)} />}
    </Drawer>
    <Drawer title={selected?.name ?? '任务病例'} open={!!selected} onClose={() => setSelected(undefined)} width={650} destroyOnHidden>
      {selected && <TaskCases key={selected.id} token={token} taskId={selected.id} />}
    </Drawer>
  </section>;
}

function TaskCases({ token, taskId }: { token: string; taskId: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<TaskCase>>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(undefined); setData(undefined); setLoading(true);
    tasksApi.cases(token, taskId, page, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, taskId, page, revision]);
  return <>
    {error && <Alert type="error" message={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>} />}
    <Table rowKey="id" columns={columns} dataSource={data?.items ?? []} loading={loading} pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }} />
  </>;
}

type TaskForm = Omit<CreateTask, 'case_ids'>;
export function CreateTaskForm({ token, onCreated, onBusyChange }: { token: string; onCreated: (result?: { auto_dispatch?: AutoDispatch }) => void; onBusyChange?: (busy: boolean) => void }) {
  const [form] = Form.useForm<TaskForm>();
  const source = Form.useWatch('source', form) as ImportSource | undefined;
  const system = Form.useWatch('system_code', form) as SystemCode | undefined;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<TaskCase>>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [loadError, setLoadError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const clearScope = () => { setSelected([]); setPage(1); setData(undefined); setSaveError(undefined); };
  useEffect(() => {
    const controller = new AbortController(); setLoadError(undefined); setData(undefined);
    if (!source || !system) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    tasksApi.eligible(token, { source, system_code: system, page, pageSize: 20 }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(message(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, source, system, page, revision]);
  const submit = async (values: TaskForm) => {
    if (pending.current) return;
    if (!selected.length || selected.length > 2000) { setSaveError('请选择 1～2000 个病例'); return; }
    pending.current = true; setSaving(true); onBusyChange?.(true); setSaveError(undefined);
    try { const result = await tasksApi.create(token, { ...values, name: values.name.trim(), case_ids: selected }); onCreated(result); }
    catch (reason) { setSaveError(message(reason)); }
    finally { pending.current = false; setSaving(false); onBusyChange?.(false); }
  };
  return <Form form={form} layout="vertical" initialValues={{ priority: 0, dispatch_mode: 'auto' }} onFinish={submit} disabled={saving}>
    <Form.Item name="name" label="任务名称" rules={[{ validator: (_, value: unknown) => typeof value === 'string' && value.trim() && [...value.trim()].length <= 200 ? Promise.resolve() : Promise.reject(new Error('任务名称需为 1～200 个字符')) }]}><Input /></Form.Item>
    <Space wrap align="start">
      <Form.Item name="source" label="数据来源" rules={[{ required: true, message: '请选择数据来源' }]}><Select style={{ width: 200 }} options={[...IMPORT_SOURCE_OPTIONS]} onChange={clearScope} /></Form.Item>
      <Form.Item name="system_code" label="系统" rules={[{ required: true, message: '请选择系统' }]}><Select style={{ width: 180 }} options={[...SYSTEM_OPTIONS]} onChange={clearScope} /></Form.Item>
      <Form.Item name="review_mode" label="审核模式" rules={[{ required: true, message: '请选择审核模式' }]}><Select style={{ width: 140 }} options={[{ value: 'self', label: '自审' }, { value: 'peer', label: '他审' }]} /></Form.Item>
      <Form.Item name="dispatch_mode" label="分发模式" rules={[{ required: true }]}><Select style={{ width: 150 }} options={DISPATCH_MODES} /></Form.Item>
      <Form.Item name="priority" label="优先级" rules={[{ required: true, message: '请填写优先级' }, { type: 'integer', min: -2147483648, max: 2147483647, message: '优先级须为有效整数' }]}><InputNumber precision={0} /></Form.Item>
    </Space>
    {loadError && <Alert type="error" message={loadError} />}
    {source && system ? <>
      <Space style={{ marginBottom: 8 }}><Typography.Text>已选 {selected.length} 例</Typography.Text><Button disabled={saving} onClick={() => { clearScope(); setRevision(value => value + 1); }}>刷新候选病例</Button></Space>
      <Table<TaskCase> size="small" rowKey="id" columns={columns} dataSource={data?.items ?? []} loading={loading}
        rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true,
          getCheckboxProps: () => ({ disabled: saving }), onChange: keys => { setSelected(keys.map(String)); setSaveError(undefined); } }}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }} />
    </> : <Typography.Paragraph type="secondary">选择数据来源和系统后，可勾选已确认脱敏且尚未入任务的病例。</Typography.Paragraph>}
    {saveError && <Alert type="error" message={saveError} style={{ marginBottom: 12 }} />}
    <Button htmlType="submit" type="primary" loading={saving} disabled={!selected.length || selected.length > 2000 || loading || !!loadError}>创建任务</Button>
  </Form>;
}
