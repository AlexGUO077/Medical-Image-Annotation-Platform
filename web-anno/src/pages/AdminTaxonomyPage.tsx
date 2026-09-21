import { Alert, Card, Empty, List, Spin, Tag, Tree, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { DataNode } from 'antd/es/tree';
import type { Session } from '../auth/types';
import { getTaxonomyTree } from '../taxonomy/api';
import type { TaxonomyNode, TaxonomyTreeResponse } from '../taxonomy/types';

interface AdminTaxonomyPageProps {
  session: Session;
}

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

export function AdminTaxonomyPage({ session }: AdminTaxonomyPageProps) {
  const [data, setData] = useState<TaxonomyTreeResponse>();
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    let active = true;
    void getTaxonomyTree(session.token)
      .then((result) => {
        if (!active) return;
        setData(result);
        setSelectedId(findFirstDisease(result.tree)?.id ?? result.tree[0]?.id);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '标签数据加载失败');
      });
    return () => { active = false; };
  }, [session.token]);

  const selected = useMemo(
    () => data && selectedId ? findNode(data.tree, selectedId) : undefined,
    [data, selectedId],
  );
  const visibleSigns = selected?.level === 3 ? selected.sign_tags ?? [] : data?.sign_tags ?? [];

  return (
    <main className="taxonomy-admin-page">
      <div className="taxonomy-page-heading">
        <div>
          <Typography.Title level={1}>系统管理</Typography.Title>
          <Typography.Text type="secondary">标签树与征象规范</Typography.Text>
        </div>
        <Tag>只读</Tag>
      </div>
      {error ? <Alert type="error" showIcon message="无法加载标签数据" description={error} /> : null}
      {!data && !error ? <div className="taxonomy-loading"><Spin aria-label="正在加载标签树" /></div> : null}
      {data ? (
        <div className="taxonomy-grid">
          <Card title="四级疾病树" size="small">
            {data.tree.length > 0 ? (
              <Tree
                defaultExpandAll
                selectedKeys={selectedId ? [selectedId] : []}
                treeData={toTreeData(data.tree)}
                onSelect={(keys) => setSelectedId(keys[0]?.toString())}
              />
            ) : <Empty description="暂无标签节点" />}
          </Card>
          <Card title={selected?.level === 3 ? `${selected.name} 可用征象` : '征象规范'} size="small">
            {selected?.synonyms.length ? (
              <Typography.Paragraph>
                <Typography.Text strong>同义词：</Typography.Text>
                {selected.synonyms.join('、')}
              </Typography.Paragraph>
            ) : null}
            <List
              size="small"
              dataSource={visibleSigns}
              locale={{ emptyText: '暂无征象规范' }}
              renderItem={(tag) => (
                <List.Item key={tag.id}>
                  <List.Item.Meta title={tag.name} description={tag.definition} />
                </List.Item>
              )}
            />
          </Card>
        </div>
      ) : null}
    </main>
  );
}
