import { Alert, Button, Card, Descriptions, Form, Input, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '../auth/types';
import { casesDetailApi, caseEditApi, type CaseDetail, type CaseReport, type ClinicalInput } from '../cases/detail-api';
import { CONFIRM_METHODS, SYSTEM_OPTIONS } from '../cases/types';
import { CaseAttachmentsPanel } from './CaseAttachmentsPanel';
import { CaseLifecyclePanel } from './CaseLifecyclePanel';

export function CaseClinicalPage({ session }: { session: Session }) {
  const { id } = useParams<{ id: string }>();
  return id ? <CaseClinicalContent key={`${id}:${session.token}`} id={id} session={session} /> : null;
}
function CaseClinicalContent({ id, session }: { id: string; session: Session }) {
  const [detail, setDetail] = useState<CaseDetail>();
  const [report, setReport] = useState<CaseReport>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [clinical] = Form.useForm<ClinicalInput>();
  const [teaching] = Form.useForm<{ difficulty: string; applicable_level: string; sign_points: string }>();
  useEffect(() => {
    let active = true;
    void Promise.all([casesDetailApi.detail(session.token, id), casesDetailApi.report(session.token, id)])
      .then(([next, nextReport]) => { if (active) { setDetail(next); setReport(nextReport); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '病例读取失败'); });
    return () => { active = false; };
  }, [id, session.token]);
  useEffect(() => {
    if (!detail) return;
    clinical.setFieldsValue({ clinical_text: detail.clinical_text ?? '', age_band: detail.age_band ?? '', sex: detail.sex ?? '', confirm_method: detail.confirm_method });
    teaching.setFieldsValue({ difficulty: String(detail.teaching_fields?.difficulty ?? ''), applicable_level: String(detail.teaching_fields?.applicable_level ?? ''),
      sign_points: Array.isArray(detail.teaching_fields?.sign_points) ? detail.teaching_fields.sign_points.join('\n') : '' });
  }, [detail?.id, clinical, teaching]);
  const editable = !!detail && ['已录入', '待分配'].includes(detail.status);
  async function save(isTeaching: boolean) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      if (isTeaching) {
        const values = await teaching.validateFields();
        const next = await caseEditApi.teaching(session.token, id, { ...values, sign_points: values.sign_points.split('\n').map((v) => v.trim()).filter(Boolean) });
        teaching.setFieldsValue({ ...next, sign_points: next.sign_points.join('\n') });
        setNotice(`教学字段已保存，遮蔽 ${next.masked_count} 处`);
      } else {
        const values = await clinical.validateFields();
        const next = await caseEditApi.clinical(session.token, id, values);
        clinical.setFieldsValue(next); setNotice(`临床信息已保存，遮蔽 ${next.masked_count} 处`);
      }
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '保存失败，请检查输入'); }
    finally { setBusy(false); }
  }
  return <main className="case-import-page">
    <Typography.Title level={1}>病例与临床信息</Typography.Title>
    {error ? <Alert type="error" showIcon message={error} /> : null}
    {notice ? <Alert type="success" showIcon message={notice} /> : null}
    {!detail && !error ? <Spin aria-label="正在加载病例" /> : null}
    {detail ? <Space direction="vertical" size="large" className="case-import-stack">
      <Card title="病例概况"><Descriptions column={2} items={[
        { key: 'number', label: '病例号', children: detail.case_no }, { key: 'status', label: '状态', children: detail.status },
        { key: 'source', label: '来源', children: detail.source === 'synthetic' ? '合成数据' : detail.source === 'teacher_provided_teaching' ? '老师提供的教学样例' : '未知来源' },
        { key: 'system', label: '系统', children: SYSTEM_OPTIONS.find((item) => item.value === detail.system_code)?.label ?? detail.system_code },
      ]} /><p>标注版本：{detail.annotation_version}</p>
      {session.role==='admin'&&<CaseLifecyclePanel detail={detail} token={session.token}
        onChanged={value=>{setDetail(old=>old?{...old,status:value.status,annotation_version:value.version}:old);setNotice(value.status==='已下线'?'病例已下线，旧金标准和历史保留':`病例已重新启用，版本 ${value.version}，等待原任务分派`);}}
        onDenied={message=>{setDetail(undefined);setReport(undefined);setNotice(undefined);setError(message);}}
        onReload={async()=>{const next=await casesDetailApi.detail(session.token,id);if(next.id!==id)throw new Error('病例响应不匹配');setDetail(next);setNotice(undefined);}}/>}
      </Card>
      {!editable ? <Alert type="info" message="病例当前状态仅允许查看" /> : null}
      <Card title="临床信息">
        <Form form={clinical} layout="vertical" disabled={!editable || busy} onFinish={() => void save(false)}>
          <Form.Item name="clinical_text" label="临床信息"><Input.TextArea rows={6} maxLength={2 * 1024 * 1024} placeholder="粘贴临床信息，保存时自动脱敏" /></Form.Item>
          <Form.Item name="age_band" label="年龄段"><Input maxLength={100} /></Form.Item>
          <Form.Item name="sex" label="性别"><Select options={['', '男', '女', '未知'].map((value) => ({ value, label: value || '未填写' }))} /></Form.Item>
          <Form.Item name="confirm_method" label="确诊方式" rules={[{ required: true }]}><Select options={CONFIRM_METHODS.map((value) => ({ value, label: value }))} /></Form.Item>
          {editable ? <Button htmlType="submit" type="primary" loading={busy}>保存临床信息</Button> : null}
        </Form>
      </Card>
      <Card title="已脱敏报告">{report?.sentences.length ? report.sentences.map((sentence) => <Typography.Paragraph key={sentence.idx}>{sentence.idx + 1}. {sentence.text}</Typography.Paragraph>) : <Typography.Text>暂无报告</Typography.Text>}</Card>
      <Card title="教学字段">
        <Form form={teaching} layout="vertical" disabled={!editable || busy} onFinish={() => void save(true)}>
          <Form.Item name="difficulty" label="难度"><Input maxLength={100} /></Form.Item>
          <Form.Item name="applicable_level" label="适用层级"><Input maxLength={100} /></Form.Item>
          <Form.Item name="sign_points" label="征象要点（每行一项，最多 50 项）"><Input.TextArea rows={4} maxLength={50_000} /></Form.Item>
          {editable ? <Button htmlType="submit" loading={busy}>保存教学字段</Button> : null}
        </Form>
      </Card>
      <CaseAttachmentsPanel id={id} session={session} items={detail.attachments} editable={editable}
        onConfirmed={async () => { const next = await casesDetailApi.detail(session.token, id); setDetail((old) => old ? { ...old, attachments: next.attachments } : next); }} />
    </Space> : null}
  </main>;
}
