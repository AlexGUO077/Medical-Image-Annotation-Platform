import { Alert, Button, Card, Checkbox, Image, List, Pagination, Progress, Select, Space, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../auth/types';
import { caseEditApi, type AttachmentProgress, type CaseAttachment } from '../cases/detail-api';

export function CaseAttachmentsPanel({ id, session, items, editable, onConfirmed }: {
  id: string; session: Session; items: CaseAttachment[]; editable: boolean; onConfirmed: () => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [upload, setUpload] = useState<string>();
  const [status, setStatus] = useState<AttachmentProgress>();
  const [target, setTarget] = useState<{ id: string; pending: boolean }>();
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(1);
  const [url, setUrl] = useState<string>();
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState(false);
  const [kind, setKind] = useState('检查报告');
  const abort = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort(); }; }, []);

  useEffect(() => {
    if (!upload) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await caseEditApi.progress(session.token, id, upload);
        if (!active) return;
        setStatus(next);
        if (next.status === 'pending_confirmation') {
          setTarget({ id: upload, pending: true }); setPage(1); setCount(next.page_count);
        } else if (next.status === 'failed') {
          setError('附件安全处理失败，请提交已去标识化且格式有效的版本。');
        } else timer = setTimeout(() => void poll(), 1500);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '处理进度读取失败'); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [id, session.token, upload]);

  useEffect(() => {
    if (!target) return;
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined); setError(undefined);
    void caseEditApi.preview(session.token, id, target.id, page, target.pending).then((result) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(result.blob); setUrl(objectUrl);
      if (!target.pending) setCount(result.page_count);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '安全预览失败'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, session.token, target, page]);

  async function receive(file: File) {
    setBusy(true); setError(undefined); setStatus(undefined); setUpload(undefined);
    setTarget(undefined); setUrl(undefined); setChecked(false); setViewed(new Set()); setPercent(0);
    abort.current = new AbortController();
    try {
      const next = await caseEditApi.upload(session.token, id, file, (bytes) => {
        if (mounted.current) setPercent(Math.round(bytes / file.size * 100));
      }, abort.current.signal);
      if (mounted.current) setUpload(next);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '上传失败'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function confirm() {
    if (!upload || !checked || !url || viewed.size !== count || !target?.pending) return;
    setBusy(true); setError(undefined);
    try {
      await caseEditApi.confirm(session.token, id, upload, kind);
      setUpload(undefined); setStatus(undefined); setTarget(undefined); setUrl(undefined); setChecked(false);
      await onConfirmed();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败'); }
    finally { setBusy(false); }
  }
  const processing = !!upload && (!status || ['receiving', 'processing'].includes(status.status));
  return <Card title="附件与安全预览">
    <Space direction="vertical" className="case-import-stack">
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <List dataSource={items} locale={{ emptyText: '暂无已确认附件' }} renderItem={(item) => <List.Item actions={[
        <Button key="preview" disabled={busy || processing || status?.status === 'pending_confirmation'} onClick={() => {
          setTarget({ id: item.id, pending: false }); setPage(1); setCount(1);
        }}>只读预览</Button>,
      ]}><List.Item.Meta title={item.filename} description={`${item.kind} · ${item.size} 字节 · 已确认脱敏`} /></List.Item>} />
      {editable ? <>
        <Upload accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" showUploadList={false} maxCount={1}
          disabled={busy || processing || status?.status === 'pending_confirmation'} beforeUpload={(file) => { void receive(file); return false; }}>
          <Button disabled={busy || processing || status?.status === 'pending_confirmation'}>上传附件</Button>
        </Upload>
        <Typography.Text type="secondary">PDF/JPG/PNG/DOCX/XLSX，单文件 ≤50 MB；原始文件名不上传，处理通过后须人工确认。</Typography.Text>
        {(busy || upload) ? <><Progress percent={percent} /><Typography.Text>已接收分片字节进度；安全处理状态：{processing ? '处理中' : status?.status === 'pending_confirmation' ? '待确认' : status?.status === 'failed' ? '失败' : '上传中'}</Typography.Text></> : null}
      </> : null}
      {target ? <>
        {url ? <Image src={url} preview={false} alt={`附件第 ${page} 页水印预览`} onLoad={() => {
          if (target.pending) setViewed((old) => new Set([...old, page]));
        }} /> : <Typography.Text>正在加载安全预览…</Typography.Text>}
        <Pagination simple current={page} pageSize={1} total={count} onChange={setPage} />
      </> : null}
      {status?.status === 'pending_confirmation' ? <>
        <Select aria-label="附件类型" value={kind} onChange={setKind} options={['检查报告', '病理', '其他'].map((value) => ({ value, label: value }))} />
        <Checkbox checked={checked} disabled={viewed.size !== count} onChange={(e) => setChecked(e.target.checked)}>我已逐页核对并确认附件不含身份标识</Checkbox>
        <Button type="primary" loading={busy} disabled={!checked || !url || viewed.size !== count} onClick={() => void confirm()}>确认附件入库</Button>
      </> : null}
    </Space>
  </Card>;
}
