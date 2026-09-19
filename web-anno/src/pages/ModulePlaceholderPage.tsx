import { Card, Typography } from 'antd';

interface ModulePlaceholderPageProps {
  title: string;
}

export function ModulePlaceholderPage({ title }: ModulePlaceholderPageProps) {
  return (
    <main className="module-placeholder">
      <Card variant="outlined">
        <Typography.Title level={1}>{title}</Typography.Title>
        <Typography.Paragraph>该模块将在对应工作包实现</Typography.Paragraph>
      </Card>
    </main>
  );
}
