import { Spin } from 'antd';
import type { ReactNode } from 'react';

export function ViewerPageState({ loading, children }: { loading?: string; children?: ReactNode }) {
  return <div className="viewer-page-state">
    {loading ? <div className="viewer-page-loading" role="status"><Spin aria-hidden="true" /><span>{loading}</span></div> : children}
  </div>;
}
