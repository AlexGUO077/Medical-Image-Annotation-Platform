import { Alert, Button, Card, Checkbox, Image, Input, Select, Space, Steps, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Session } from '../auth/types';
import { casesManualApi, type ManualCaseCreated, type ManualDraft } from '../cases/manual-api';
import { CONFIRM_METHODS, IMPORT_SOURCE_OPTIONS, SYSTEM_OPTIONS, type ConfirmMethod, type ImportSource, type SystemCode } from '../cases/types';

const { Dragger } = Upload;
const steps = ['数据来源', '报告文本', '关键影像', '脱敏确认', '完成'];

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '手工录入失败';
}

export function ManualEntryPanel({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [source, setSource] = useState<ImportSource>();
  const [report, setReport] = useState('');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [draft, setDraft] = useState<ManualDraft>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [created, setCreated] = useState<ManualCaseCreated>();
  const [systemCode, setSystemCode] = useState<SystemCode>();
  const [confirmMethod, setConfirmMethod] = useState<ConfirmMethod>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function prepare() {
    const image = files[0]?.originFileObj;
    if (!source || !report.trim() || !image) return;
    if (!['image/jpeg', 'image/png'].includes(image.type) || image.size > 50 * 1024 * 1024) {
      setError('关键影像须为不超过 50 MB 的 JPG/PNG');
      return;
    }
    if (new TextEncoder().encode(report).length > 2 * 1024 * 1024) {
      setError('报告文本不能超过 2 MB');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = await casesManualApi.prepare(session.token, source, report, image);
      const blob = await casesManualApi.preview(session.token, next.draft_id);
      setDraft(next);
      setPreviewUrl(URL.createObjectURL(blob));
      setReport('');
      setFiles([]);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!draft || !systemCode || !confirmMethod || !checked || !previewUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await casesManualApi.confirm(session.token, draft.draft_id, systemCode, confirmMethod);
      setCreated(next);
      navigate(`/cases/${next.case_id}`);
      setDraft(undefined);
      setChecked(false);
      setPreviewUrl(undefined);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const step = created ? 4 : draft ? 3 : !source ? 0 : !report.trim() ? 1 : 2;
  return (
    <Space direction="vertical" size="large" className="case-import-stack">
      <Steps current={step} size="small" items={steps.map((title) => ({ title }))} />
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {created ? (
        <Card title="手工病例已录入">
          <Typography.Paragraph>病例号：{created.case_no}；状态：{created.status}</Typography.Paragraph>
          <Link to={`/cases/${created.case_id}`}>进入病例与临床信息</Link>
        </Card>
      ) : draft ? (
        <Card title="脱敏结果人工确认">
          <Alert type="warning" showIcon message="仅确认服务端处理后的报告与关键影像；未确认前不会正式入库。" />
          <Typography.Paragraph>报告遮蔽 {draft.masked_count} 处；关键影像遮盖 {draft.image_redaction_count} 处。</Typography.Paragraph>
          <Typography.Paragraph>草稿有效至：{new Date(draft.expires_at).toLocaleString()}</Typography.Paragraph>
          <Card size="small" title="已脱敏报告"><Typography.Paragraph>{draft.masked_report}</Typography.Paragraph></Card>
          <Card size="small" title="带水印的安全影像预览">
            {previewUrl ? <Image src={previewUrl} preview={false} alt="已脱敏且带水印的关键影像" /> : null}
          </Card>
          <Space direction="vertical" className="case-import-stack">
            <Select aria-label="病例系统" placeholder="选择八大系统" value={systemCode} options={[...SYSTEM_OPTIONS]} onChange={setSystemCode} />
            <Select aria-label="确诊方式" placeholder="选择确诊方式" value={confirmMethod}
              options={CONFIRM_METHODS.map((value) => ({ value, label: value }))} onChange={setConfirmMethod} />
            <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)}>
              我已核对报告和影像的去标识化结果，确认正式录入
            </Checkbox>
            <Button type="primary" loading={busy} disabled={!systemCode || !confirmMethod || !checked || !previewUrl}
              onClick={() => void confirm()}>确认并创建病例</Button>
          </Space>
        </Card>
      ) : (
        <>
          <Card title="1  数据来源">
            <Select aria-label="手工录入数据来源" placeholder="请选择数据来源" value={source}
              options={[...IMPORT_SOURCE_OPTIONS]} onChange={setSource} disabled={busy} />
            <Alert className="case-import-note" type="info" showIcon
              message="仅接受 D-31 已批准的数据来源"
              description="老师提供的教学样例仅限本项目开发测试；授权撤回后停止录入并清理。" />
          </Card>
          <Card title="2  报告文本">
            <Input.TextArea aria-label="报告文本" value={report} rows={8} maxLength={2 * 1024 * 1024}
              disabled={busy} onChange={(event) => setReport(event.target.value)}
              placeholder="粘贴报告文本；服务端脱敏后才会展示确认版本" />
          </Card>
          <Card title="3  关键影像">
            <Dragger accept=".jpg,.jpeg,.png,image/jpeg,image/png" beforeUpload={() => false}
              fileList={files} maxCount={1} multiple={false} disabled={busy} showUploadList={false}
              onChange={({ fileList }) => setFiles(fileList.slice(-1))}>
              <Typography.Title level={4}>选择一张 JPG/PNG 关键影像</Typography.Title>
              <Typography.Text type="secondary">不在浏览器预览原图；单文件不超过 50 MB。</Typography.Text>
            </Dragger>
            {files.length === 1 ? <Typography.Paragraph type="secondary">已选择 1 张影像；不显示或上传原文件名。</Typography.Paragraph> : null}
            <Button type="primary" loading={busy} disabled={!source || !report.trim() || files.length !== 1}
              onClick={() => void prepare()}>安全处理并查看脱敏结果</Button>
          </Card>
        </>
      )}
    </Space>
  );
}
