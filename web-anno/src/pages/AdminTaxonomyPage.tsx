import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '../auth/types';
import { taxonomyApi } from '../taxonomy/api';
import type { SignTag, SignTagListResponse, TaxonomyNode, TaxonomyTreeResponse } from '../taxonomy/types';

interface AdminTaxonomyPageProps {
  session: Session;
}

interface NodeFormValue {
  name: string;
  synonymsText: string;
  icd?: string;
}

interface SignFormValue {
  name: string;
  system_code: string;
  definition: string;
}

type NodeModal = { mode: 'create'; parent: TaxonomyNode } | { mode: 'edit'; node: TaxonomyNode };
type SignModal = { mode: 'create' } | { mode: 'edit'; sign: SignTag };

const SYSTEM_OPTIONS = [
  ['cns', '中枢神经系统'],
  ['headneck', '头颈'],
  ['resp', '呼吸'],
  ['circ', '循环'],
  ['digest', '消化'],
  ['uro', '泌尿'],
  ['repro', '生殖'],
  ['bone', '骨骼'],
].map(([value, label]) => ({ value, label }));

function toTreeData(nodes: TaxonomyNode[]): DataNode[] {
  return nodes.map((node) => ({ key: node.id, title: node.name, children: toTreeData(node.children) }));
}

function findFirstDisease(nodes: TaxonomyNode[]): TaxonomyNode | undefined {
  for (const node of nodes) {
    if (node.level === 3) return node;
    const nested = findFirstDisease(node.children);
    if (nested) return nested;
  }
  return undefined;
}

function findNode(nodes: TaxonomyNode[], id: string): TaxonomyNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return undefined;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '标签管理请求失败';
}

export function AdminTaxonomyPage({ session }: AdminTaxonomyPageProps) {
  const [treeData, setTreeData] = useState<TaxonomyTreeResponse>();
  const [signData, setSignData] = useState<SignTagListResponse>();
  const [selectedId, setSelectedId] = useState<string>();
  const [page, setPage] = useState(1);
  const [systemCode, setSystemCode] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [nodeModal, setNodeModal] = useState<NodeModal>();
  const [signModal, setSignModal] = useState<SignModal>();
  const [nodeForm] = Form.useForm<NodeFormValue>();
  const [signForm] = Form.useForm<SignFormValue>();

  const loadTree = useCallback(async () => {
    const result = await taxonomyApi.tree(session.token);
    setTreeData(result);
    setSelectedId((current) => current && findNode(result.tree, current)
      ? current
      : findFirstDisease(result.tree)?.id ?? result.tree[0]?.id);
  }, [session.token]);

  const loadSigns = useCallback(async () => {
    setSignData(await taxonomyApi.signTags(session.token, page, 20, systemCode, keyword));
  }, [keyword, page, session.token, systemCode]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadTree(), loadSigns()]).catch((reason: unknown) => {
      if (active) setLoadError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [loadSigns, loadTree]);

  const selected = useMemo(
    () => treeData && selectedId ? findNode(treeData.tree, selectedId) : undefined,
    [selectedId, treeData],
  );

  function openCreateNode() {
    if (!selected || selected.level === 4) return;
    nodeForm.resetFields();
    nodeForm.setFieldsValue({ synonymsText: '' });
    setNodeModal({ mode: 'create', parent: selected });
  }

  function openEditNode() {
    if (!selected || selected.level === 1) return;
    nodeForm.setFieldsValue({
      name: selected.name,
      synonymsText: selected.synonyms.join('，'),
      icd: selected.icd ?? undefined,
    });
    setNodeModal({ mode: 'edit', node: selected });
  }

  function openCreateSign() {
    signForm.resetFields();
    if (systemCode) signForm.setFieldValue('system_code', systemCode);
    setSignModal({ mode: 'create' });
  }

  function openEditSign(sign: SignTag) {
    signForm.setFieldsValue(sign);
    setSignModal({ mode: 'edit', sign });
  }

  async function saveNode(values: NodeFormValue) {
    if (!nodeModal) return;
    setSaving(true);
    setOperationError(undefined);
    try {
      const input = {
        name: values.name,
        synonyms: values.synonymsText.split(/[,，]/).map((value) => value.trim()).filter(Boolean),
        icd: values.icd?.trim() || null,
      };
      if (nodeModal.mode === 'create') {
        await taxonomyApi.createNode(session.token, { parent_id: nodeModal.parent.id, ...input });
        setNotice('标签节点已创建');
      } else {
        await taxonomyApi.updateNode(session.token, nodeModal.node.id, input);
        setNotice('标签节点已更新');
      }
      setNodeModal(undefined);
      await loadTree();
    } catch (reason: unknown) {
      setOperationError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteNode() {
    if (!selected || selected.level === 1) return;
    setOperationError(undefined);
    try {
      await taxonomyApi.deleteNode(session.token, selected.id);
      setNotice('标签节点已删除');
      setSelectedId(undefined);
      await loadTree();
    } catch (reason: unknown) {
      setOperationError(errorMessage(reason));
    }
  }

  async function saveSign(values: SignFormValue) {
    if (!signModal) return;
    setSaving(true);
    setOperationError(undefined);
    try {
      if (signModal.mode === 'create') {
        await taxonomyApi.createSignTag(session.token, values);
        setNotice('征象已创建');
      } else {
        await taxonomyApi.updateSignTag(session.token, signModal.sign.id, values);
        setNotice('征象已更新');
      }
      setSignModal(undefined);
      await Promise.all([loadSigns(), loadTree()]);
    } catch (reason: unknown) {
      setOperationError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSign(sign: SignTag) {
    setOperationError(undefined);
    try {
      await taxonomyApi.deleteSignTag(session.token, sign.id);
      setNotice('征象已删除');
      await Promise.all([loadSigns(), loadTree()]);
    } catch (reason: unknown) {
      setOperationError(errorMessage(reason));
    }
  }

  return (
    <main className="taxonomy-admin-page">
      <div className="taxonomy-page-heading">
        <div>
          <Typography.Title level={1}>系统管理</Typography.Title>
          <Typography.Text type="secondary">标签树与征象规范</Typography.Text>
        </div>
        <Tag color="blue">管理员维护</Tag>
      </div>
      {loadError ? <Alert type="error" showIcon message="无法加载标签数据" description={loadError} /> : null}
      {operationError ? <Alert closable type="error" showIcon message="操作失败" description={operationError} onClose={() => setOperationError(undefined)} /> : null}
      {notice ? <Alert closable type="success" showIcon message={notice} onClose={() => setNotice(undefined)} /> : null}
      {!treeData && !loadError ? <div className="taxonomy-loading"><Spin aria-label="正在加载标签树" /></div> : null}
      {treeData ? (
        <div className="taxonomy-grid">
          <Card
            title="四级疾病树"
            size="small"
            extra={(
              <Space>
                <Button size="small" disabled={!selected || selected.level === 4} onClick={openCreateNode}>新增子节点</Button>
                <Button size="small" disabled={!selected || selected.level === 1} onClick={openEditNode}>编辑</Button>
                <Popconfirm title="确认删除该标签节点？" onConfirm={deleteNode}>
                  <Button danger size="small" disabled={!selected || selected.level === 1}>删除</Button>
                </Popconfirm>
              </Space>
            )}
          >
            {treeData.tree.length > 0 ? (
              <Tree
                defaultExpandAll
                selectedKeys={selectedId ? [selectedId] : []}
                treeData={toTreeData(treeData.tree)}
                onSelect={(keys) => setSelectedId(keys[0]?.toString())}
              />
            ) : <Empty description="暂无标签节点" />}
            {selected?.synonyms.length ? (
              <Typography.Paragraph className="taxonomy-node-detail">
                <Typography.Text strong>同义词：</Typography.Text>
                {selected.synonyms.join('、')}
              </Typography.Paragraph>
            ) : null}
          </Card>
          <Card title="征象规范" size="small" extra={<Button size="small" type="primary" onClick={openCreateSign}>新增征象</Button>}>
            <Space wrap className="taxonomy-filters">
              <Select
                allowClear
                placeholder="全部系统"
                options={SYSTEM_OPTIONS}
                value={systemCode}
                onChange={(value) => { setSystemCode(value); setPage(1); }}
              />
              <Input.Search
                allowClear
                placeholder="按征象名称检索"
                onSearch={(value) => { setKeyword(value); setPage(1); }}
              />
            </Space>
            <List
              size="small"
              loading={!signData}
              dataSource={signData?.items ?? []}
              locale={{ emptyText: '暂无征象规范' }}
              renderItem={(sign) => (
                <List.Item actions={[
                  <Button key="edit" type="link" size="small" onClick={() => openEditSign(sign)}>编辑</Button>,
                  <Popconfirm key="delete" title="确认删除该征象？" onConfirm={() => deleteSign(sign)}>
                    <Button danger type="link" size="small">删除</Button>
                  </Popconfirm>,
                ]}>
                  <List.Item.Meta
                    title={<Space>{sign.name}<Tag>{sign.system_code}</Tag></Space>}
                    description={sign.definition}
                  />
                </List.Item>
              )}
            />
            {signData && signData.total > signData.pageSize ? (
              <Pagination
                current={signData.page}
                pageSize={signData.pageSize}
                total={signData.total}
                showSizeChanger={false}
                onChange={setPage}
              />
            ) : null}
          </Card>
        </div>
      ) : null}

      <Modal
        open={Boolean(nodeModal)}
        title={nodeModal?.mode === 'create' ? '新增标签节点' : '编辑标签节点'}
        confirmLoading={saving}
        onCancel={() => setNodeModal(undefined)}
        onOk={() => nodeForm.submit()}
      >
        <Form form={nodeForm} layout="vertical" onFinish={saveNode}>
          <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="synonymsText" label="同义词" extra="多个同义词使用逗号分隔">
            <Input />
          </Form.Item>
          <Form.Item name="icd" label="ICD 编码（可选）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(signModal)}
        title={signModal?.mode === 'create' ? '新增征象' : '编辑征象'}
        confirmLoading={saving}
        onCancel={() => setSignModal(undefined)}
        onOk={() => signForm.submit()}
      >
        <Form form={signForm} layout="vertical" onFinish={saveSign}>
          <Form.Item name="name" label="征象名称" rules={[{ required: true, whitespace: true, message: '请输入征象名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="system_code" label="所属系统" rules={[{ required: true, message: '请选择所属系统' }]}>
            <Select options={SYSTEM_OPTIONS} />
          </Form.Item>
          <Form.Item name="definition" label="定义与标注规范" rules={[{ required: true, whitespace: true, message: '请输入定义与标注规范' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
