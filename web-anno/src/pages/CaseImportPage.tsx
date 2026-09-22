import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Image,
  Modal,
  Select,
  Space,
  Statistic,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import { useEffect, useState } from 'react';
import type { Session } from '../auth/types';
import { casesImportApi } from '../cases/api';
import {
  CONFIRM_METHODS,
  IMPORT_SOURCE_OPTIONS,
  SYSTEM_OPTIONS,
  type ConfirmImportInput,
  type ImportProgress,
  type ImportProgressItem,
  type ImportSource,
  type ItemStatus,
} from '../cases/types';

const { Dragger } = Upload;

interface CaseImportPageProps {
  session: Session;
}

const statusLabels: Record<ItemStatus, string> = {
  queued: '排队中',
  processing: '处理中',
  awaiting_confirmation: '待人工确认',
  completed: '成功',
  duplicate: '重复跳过',
  failed: '失败',
};

const statusColors: Record<ItemStatus, string> = {
  queued: 'default',
  processing: 'processing',
  awaiting_confirmation: 'warning',
  completed: 'success',
  duplicate: 'default',
  failed: 'error',
};

const stepStages = [
  '数据来源',
  '选择文件',
  '上传与安全检查',
  '解析与脱敏',
  '人工确认',
  '导入结果',
];

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '导入请求失败';
}

function stepIndex(
  progress: ImportProgress | undefined,
  uploading: boolean,
  hasSource: boolean,
): number {
  if (!hasSource) return 0;
  if (!progress) return uploading ? 2 : 1;
  if (progress.status === 'queued') return 2;
  if (progress.status === 'processing') return 3;
  if (progress.status === 'awaiting_confirmation') return 4;
  return 5;
}

export function CaseImportPage({ session }: CaseImportPageProps) {
  const [source, setSource] = useState<ImportSource>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reviewItem, setReviewItem] = useState<ImportProgressItem>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmForm] = Form.useForm<ConfirmImportInput>();

  async function refresh(batchId = progress?.batch_id) {
    if (!batchId) return;
    const next = await casesImportApi.progress(session.token, batchId);
    setProgress(next);
    setReviewItem((current) => current
      ? next.items.find((item) => item.item_id === current.item_id)
      : current);
  }

  useEffect(() => {
    if (!progress || !['queued', 'processing'].includes(progress.status)) return undefined;
    const timer = window.setInterval(() => {
      void refresh(progress.batch_id).catch((reason: unknown) => setError(errorMessage(reason)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [progress?.batch_id, progress?.status]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function startImport() {
    const file = files[0]?.originFileObj;
    if (!source || !file) {
      setError('请先选择数据来源和 ZIP 文件');
      return;
    }
    setUploading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const accepted = await casesImportApi.create(session.token, source, file);
      setNotice('批次已接收，离开页面不会中断服务端处理');
      await refresh(accepted.batch_id);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  }

  async function openReview(item: ImportProgressItem) {
    setReviewItem(item);
    setPreviewLoading(true);
    setError(undefined);
    confirmForm.setFieldsValue({
      confirmed: true,
      system_code: item.review?.suggested_system_code ?? undefined,
      confirm_method: undefined,
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(undefined);
    try {
      const blob = await casesImportApi.preview(session.token, progress!.batch_id, item.item_id);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmImport(values: ConfirmImportInput) {
    if (!progress || !reviewItem) return;
    setConfirming(true);
    setError(undefined);
    try {
      await casesImportApi.confirm(session.token, progress.batch_id, reviewItem.item_id, {
        ...values,
        confirmed: true,
      });
      setNotice('脱敏结果已确认，病例已进入已录入状态');
      setReviewItem(undefined);
      await refresh(progress.batch_id);
    } catch (reason: unknown) {
      setError(errorMessage(reason));
    } finally {
      setConfirming(false);
    }
  }

  const counts = progress?.counts;
  const resultColumns = [
    { title: '病例', dataIndex: 'display_name', key: 'display_name' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (status: ItemStatus) => <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>,
    },
    { title: '阶段', dataIndex: 'stage', key: 'stage' },
    {
      title: '失败信息', key: 'failure',
      render: (_: unknown, item: ImportProgressItem) => item.failure
        ? <Typography.Text type="danger">{item.failure.code}：{item.failure.message}</Typography.Text>
        : '—',
    },
    {
      title: '操作', key: 'action',
      render: (_: unknown, item: ImportProgressItem) => item.status === 'awaiting_confirmation'
        ? <Button size="small" type="primary" onClick={() => void openReview(item)}>脱敏确认</Button>
        : null,
    },
  ];

  const batchImport = (
    <Space direction="vertical" size="large" className="case-import-stack">
      <Steps
        current={stepIndex(progress, uploading, Boolean(source))}
        size="small"
        items={stepStages.map((title) => ({ title }))}
      />

      <Card title="1  数据来源">
        <Select
          aria-label="数据来源"
          className="case-import-source"
          placeholder="请选择数据来源"
          value={source}
          options={[...IMPORT_SOURCE_OPTIONS]}
          onChange={setSource}
        />
        <Alert
          className="case-import-note"
          type="info"
          showIcon
          message="仅接受 D-31 已批准的数据来源"
          description="老师提供的教学样例仅限本项目开发测试；有效至项目验收，授权撤回后停止导入并删除已导入数据。"
        />
      </Card>

      <Card title="2  选择 ZIP 文件">
        <Dragger
          accept=".zip,application/zip"
          beforeUpload={() => false}
          fileList={files}
          maxCount={1}
          multiple={false}
          showUploadList={false}
          onChange={({ fileList }) => setFiles(fileList.slice(-1))}
          onRemove={() => { setFiles([]); return true; }}
        >
          <Typography.Title level={4}>拖拽 ZIP 到此处，或点击选择</Typography.Title>
          <Typography.Text type="secondary">浏览器不会解压或预览原始 DICOM；单包不超过 512 MiB。</Typography.Text>
        </Dragger>
        {files.length === 1 ? (
          <Typography.Paragraph className="case-import-selection" type="secondary">
            已选择 1 个 ZIP 文件；为避免身份信息泄露，不显示或上传原文件名。
          </Typography.Paragraph>
        ) : null}
        <Button
          className="case-import-submit"
          type="primary"
          loading={uploading}
          disabled={!source || files.length !== 1}
          onClick={() => void startImport()}
        >
          开始安全导入
        </Button>
      </Card>

      {progress ? (
        <Card title="3  服务端处理进度" extra={<Tag>{progress.batch_id}</Tag>}>
          <div className="case-import-statistics">
            <Statistic title="总计" value={counts?.total ?? 0} />
            <Statistic title="处理中" value={(counts?.queued ?? 0) + (counts?.processing ?? 0)} />
            <Statistic title="待人工确认" value={counts?.awaiting_confirmation ?? 0} />
            <Statistic title="成功" value={counts?.completed ?? 0} />
            <Statistic title="重复跳过" value={counts?.duplicate ?? 0} />
            <Statistic title="失败" value={counts?.failed ?? 0} />
          </div>
          <Table
            rowKey="item_id"
            columns={resultColumns}
            dataSource={progress.items}
            pagination={false}
            locale={{ emptyText: <Empty description="尚无病例处理结果" /> }}
            scroll={{ x: 780 }}
          />
        </Card>
      ) : null}
    </Space>
  );

  return (
    <main className="case-import-page">
      <div className="case-import-heading">
        <div>
          <Typography.Title level={1}>病例录入</Typography.Title>
          <Typography.Text type="secondary">批量导入、脱敏检查与人工确认</Typography.Text>
        </div>
        <Tag color="blue">管理员</Tag>
      </div>
      {error ? <Alert closable showIcon type="error" message="操作失败" description={error} onClose={() => setError(undefined)} /> : null}
      {notice ? <Alert closable showIcon type="success" message={notice} onClose={() => setNotice(undefined)} /> : null}
      <Tabs
        items={[
          { key: 'batch', label: '批量导入', children: batchImport },
          {
            key: 'manual',
            label: '手工简版录入',
            children: <Empty description="关键影像格式与存储方式需按 D-16 确认后实现" />,
          },
        ]}
      />

      <Modal
        open={Boolean(reviewItem)}
        width={900}
        title="脱敏人工确认"
        okText="确认脱敏并正式入库"
        cancelText="暂不确认"
        confirmLoading={confirming}
        onCancel={() => setReviewItem(undefined)}
        onOk={() => confirmForm.submit()}
      >
        {reviewItem?.review ? (
          <div className="case-import-review-grid">
            <Card title="去标识化影像预览" loading={previewLoading}>
              {previewUrl ? <Image alt="去标识化且带水印的影像预览" preview={false} src={previewUrl} /> : null}
            </Card>
            <Space direction="vertical" size="middle">
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="报告遮蔽数量">{reviewItem.review.masked_count}</Descriptions.Item>
                <Descriptions.Item label="OCR 结果">
                  {reviewItem.review.ocr_failed
                    ? <Tag color="error">OCR 失败，必须人工核验</Tag>
                    : `${reviewItem.review.ocr_hits.length} 处命中`}
                </Descriptions.Item>
                <Descriptions.Item label="预分类置信度">
                  {Math.round(reviewItem.review.classification_confidence * 100)}%
                </Descriptions.Item>
              </Descriptions>
              <Card size="small" title="脱敏报告">
                <Typography.Paragraph className="case-import-masked-report">
                  {reviewItem.review.masked_report || '无报告文本'}
                </Typography.Paragraph>
              </Card>
              <Card size="small" title="OCR 命中位置">
                {reviewItem.review.ocr_hits.length > 0 ? (
                  <Table
                    rowKey={(_, index) => String(index)}
                    size="small"
                    pagination={false}
                    dataSource={reviewItem.review.ocr_hits}
                    columns={[
                      { title: '命中文字', dataIndex: 'text', key: 'text' },
                      {
                        title: '置信度', dataIndex: 'confidence', key: 'confidence',
                        render: (value: number) => `${Math.round(value * 100)}%`,
                      },
                      {
                        title: '位置', dataIndex: 'box', key: 'box',
                        render: (box: number[][]) => box.map(([x, y]) => `(${x}, ${y})`).join(' '),
                      },
                    ]}
                  />
                ) : <Typography.Text type="secondary">未检测到文字命中</Typography.Text>}
              </Card>
              <Form form={confirmForm} layout="vertical" onFinish={(values) => void confirmImport(values)}>
                <Form.Item name="system_code" label="八大系统分诊" rules={[{ required: true, message: '请选择系统' }]}>
                  <Select options={[...SYSTEM_OPTIONS]} />
                </Form.Item>
                <Form.Item name="confirm_method" label="确诊方式" rules={[{ required: true, message: '请选择确诊方式' }]}>
                  <Select options={CONFIRM_METHODS.map((value) => ({ value, label: value }))} />
                </Form.Item>
              </Form>
              <Alert
                showIcon
                type="warning"
                message="确认后才会写入正式存储"
                description="当前页面仅展示去标识化结果，不提供原始 ZIP、原始标签、原始报告或 DICOM 下载。"
              />
            </Space>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
